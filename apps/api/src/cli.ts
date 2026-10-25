import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FEATURE_FLAGS, LegalDocumentSchema, PLANS, PRICE_LISTS } from "@app/shared";
import pg from "pg";
import { createDb, type RootDb } from "./db/client.ts";
import { runMigrations } from "./db/migrate.ts";
import { seed } from "./db/seed.ts";
import { noticeProblem } from "./domains/legal/index.ts";
import { setFeatureFlag, showFeatureFlags } from "./feature-flags/index.ts";
import { notifyLegalChange } from "./legal-notify/notify.ts";
import { deleteTenant, planTenantDeletion } from "./offboarding/delete-tenant.ts";
import { applicationSourceFor } from "./onboarding/application-source.ts";
import { createTenant, parseTenantApplication } from "./onboarding/create-tenant.ts";
import { planPersonData } from "./person-data/plan-person-data.ts";
import { type PlanInput, planReport, setPlan, showPlan } from "./plans/index.ts";
import { runPmfSurveyPurge, runPmfSurveyReport } from "./pmf-survey/index.ts";
import { runTenantShares, runUsagePurge, runUsageReport } from "./usage/index.ts";

// 1回きりの作業の入口。ECS では同じイメージを command だけ変えて動かす。続けて書けば順に流す。
//   node dist/cli.js migrate          … 移行(表の持ち主で。MIGRATION_DATABASE_URL か PG* の環境変数)
//   node dist/cli.js seed             … 種データ(local / test / preview だけ)
//   node dist/cli.js init-roles       … 接続ユーザーを作る(使い捨ての DB だけ。SUPERUSER_DATABASE_URL)
//   node dist/cli.js init-roles migrate seed   … プレビュー環境の起動時
//   node dist/cli.js create-tenant <申し込みの置き場のキー> [--execute --confirm-name <名前>]
//                                      … 申し込みを受けた組織と最初の管理者を作る(試し → 本番。docs/runbooks/tenant-provisioning.md)
//   node dist/cli.js person-data <組織の ID> <利用者の ID>
//                                      … 利用者1人分の開示・削除の試し(数えるだけ。docs/runbooks/person-data.md)
//   node dist/cli.js delete-tenant <組織の ID> [--execute --confirm-name <名前>]
//                                      … 解約した組織を消す(試し → 本番。docs/runbooks/offboarding.md)
//   node dist/cli.js legal-notify <文書> <版> [--execute]
//                                      … 規約の変更のお知らせを全員に積む(試し → 本番。docs/runbooks/legal-notice.md)
//   node dist/cli.js feature-flag <組織の ID> [<機能> on|off [--execute]]
//                                      … 組織に機能を入れる・切る(一覧 → 試し → 本番。docs/runbooks/feature-flags.md)
//   node dist/cli.js plan <組織の ID> [--plan <プラン> [--seats <数>|none] [--price-list <版>]
//                       [--locked-until <日>|none] [--effective-on <日>] [--execute]]
//                                      … 組織の契約のプランを見る・変える(見る → 試し → 本番。docs/runbooks/plans.md)
//   node dist/cli.js plan-report [--within-days <日数>]
//                                      … 全部の組織のプランを数える・据え置きの期限・人数の超過(読むだけ。docs/runbooks/plans.md)
//   node dist/cli.js usage-report <機能> [--weeks <週の数>]
//                                      … 利用の記録を週ごとの数と継続率にする(読むだけ。docs/runbooks/usage-records.md)
//   node dist/cli.js tenant-shares [--month YYYY-MM]
//                                      … 1社あたりの原価の按分の元(組織の大きさの帯ごとの数。読むだけ。docs/guides/cost-dashboard.md の 7)
//   node dist/cli.js usage-purge [--execute]
//                                      … 保存期間を過ぎた利用の記録を消す(試し → 本番。docs/runbooks/usage-records.md)
//   node dist/cli.js pmf-survey-report [--round 2026-Q4]
//                                      … 「無くなったら困るか」の答えを数と割合にする(読むだけ。docs/runbooks/pmf-survey.md)
//   node dist/cli.js pmf-survey-purge [--execute]
//                                      … 保存期間を過ぎた「聞き終えた印」を消す(試し → 本番。docs/runbooks/pmf-survey.md)

const appEnv = process.env.APP_ENV ?? "local";
const throwaway = appEnv === "local" || appEnv === "test" || appEnv === "preview";
// 未指定なら node-postgres が PGHOST / PGUSER / PGPASSWORD / PGDATABASE を読む(本番の移行タスク)
const migrationUrl = process.env.MIGRATION_DATABASE_URL;

async function initRoles() {
  if (!throwaway) throw new Error(`${appEnv} では使えません(本番のロールは README の手順で作る)`);
  const dir = process.env.DB_INIT_DIR ?? fileURLToPath(new URL("../db/init", import.meta.url));
  const client = new pg.Client({ connectionString: process.env.SUPERUSER_DATABASE_URL });
  await client.connect();
  try {
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      await client.query(readFileSync(join(dir, file), "utf8"));
    }
  } finally {
    await client.end();
  }
}

/**
 * 申し込みを受けた組織を作る。--execute が無ければ、流してから取り消す(試し)。結果は JSON 1行(名前・メールは出さない)。
 * 申し込みは置き場(S3)から読む。引数はキーだけ(CloudTrail に名前・メールを残さない)
 */
async function createTenantCommand(args: string[]) {
  const [key, ...flags] = args;
  if (!key) throw new Error("置き場のキーがありません: create-tenant applications/<申込番号>.json");
  const source = applicationSourceFor({ appEnv, bucket: process.env.APPLICATIONS_BUCKET });
  const { application, ignoredKeys } = parseTenantApplication(await source.read(key));
  const execute = flags.includes("--execute");
  const nameAt = flags.indexOf("--confirm-name");
  const confirmName = nameAt >= 0 ? flags[nameAt + 1] : undefined;
  if (execute && !confirmName)
    throw new Error("--execute には --confirm-name <組織の名前> が要ります");
  const { db, pool } = createDb(migrationUrl);
  try {
    const created = await createTenant(db, application, {
      execute,
      confirmName,
      supportTenantId: process.env.SUPPORT_TENANT_ID ?? null,
    });
    const line = execute
      ? { mode: "created", ...created, ignoredKeys }
      : { mode: "plan", timeZone: created.timeZone, mfaRequired: created.mfaRequired, ignoredKeys };
    process.stdout.write(`${JSON.stringify(line)}\n`);
    if (!execute) {
      process.stdout.write(
        "まだ作っていません(流してから取り消しました)。中身を確かめて --execute --confirm-name <組織の名前> を付けて流してください\n",
      );
    }
  } finally {
    await pool.end();
  }
}

/** 利用者1人分の開示・削除の試し(数えるだけ・何も変えない)。結果は JSON 1行(値は出さない) */
async function personDataCommand(args: string[]) {
  const [tenantId, userId] = args;
  const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
  if (!tenantId || !userId || !uuid.test(tenantId) || !uuid.test(userId)) {
    throw new Error(
      "使い方: person-data <組織の ID> <利用者の ID>(どちらも UUID。名前・メールは渡さない)",
    );
  }
  const { db, pool } = createDb(migrationUrl);
  try {
    const plan = await planPersonData(db, tenantId, userId);
    process.stdout.write(`${JSON.stringify({ mode: "plan", ...plan })}\n`);
    if (!plan.found)
      process.stdout.write("その組織にその利用者はいません(ID を確かめてください)\n");
  } finally {
    await pool.end();
  }
}

/** 解約した組織を消す。--execute が無ければ数えるだけ。結果は JSON 1行(組織の名前は出さない) */
async function deleteTenantCommand(args: string[]) {
  const [tenantId, ...flags] = args;
  if (!tenantId) throw new Error("組織の ID がありません: delete-tenant <組織の ID>");
  const execute = flags.includes("--execute");
  const nameAt = flags.indexOf("--confirm-name");
  const confirmName = nameAt >= 0 ? flags[nameAt + 1] : undefined;
  const { db, pool } = createDb(migrationUrl);
  try {
    if (!execute) {
      const plan = await planTenantDeletion(db, tenantId);
      if (!plan) throw new Error(`組織がありません: ${tenantId}`);
      const line = { mode: "plan", tenantId, counts: plan.counts, cognitoSubs: plan.cognitoSubs };
      process.stdout.write(`${JSON.stringify(line)}\n`);
      process.stdout.write(
        "まだ消していません。組織の名前を確かめて --execute --confirm-name <名前> を付けて流してください\n",
      );
      return;
    }
    if (!confirmName) throw new Error("--execute には --confirm-name <組織の名前> が要ります");
    const done = await deleteTenant(db, tenantId, {
      confirmName,
      supportTenantId: process.env.SUPPORT_TENANT_ID ?? null,
    });
    process.stdout.write(`${JSON.stringify({ mode: "deleted", tenantId, counts: done.counts })}\n`);
  } finally {
    await pool.end();
  }
}

/** 規約の変更のお知らせ。--execute が無ければ、組織ごとに送る人数を数えるだけ。結果は JSON 1行 */
async function legalNotifyCommand(args: string[]) {
  const [documentArg, versionArg, ...flags] = args;
  const document = LegalDocumentSchema.safeParse(documentArg);
  const version = Number(versionArg);
  if (!document.success || !Number.isInteger(version)) {
    throw new Error("使い方: legal-notify <terms|privacy> <版> [--execute]");
  }
  const ref = { document: document.data, version };
  const problem = noticeProblem(ref, new Date());
  if (problem) throw new Error(`${document.data} の版 ${version} は送れません: ${problem}`);
  const execute = flags.includes("--execute");
  const { db, pool } = createDb(migrationUrl);
  try {
    const supportTenantId = process.env.SUPPORT_TENANT_ID ?? null;
    const plan = await notifyLegalChange(db, ref, { execute, supportTenantId });
    const total = Object.values(plan.counts).reduce((a, b) => a + b, 0);
    const line = { mode: execute ? "queued" : "plan", ...ref, total, counts: plan.counts };
    process.stdout.write(`${JSON.stringify(line)}\n`);
    if (!execute) {
      process.stdout.write("まだ送っていません。人数を確かめて --execute を付けて流してください\n");
    }
  } finally {
    await pool.end();
  }
}

/** 組織ごとの機能フラグ。機能が無ければ一覧、--execute が無ければ試し。結果は JSON 1行(組織の名前は出さない) */
async function featureFlagCommand(args: string[]) {
  const [tenantId, name, onOff, ...flags] = args;
  if (!tenantId) throw new Error("使い方: feature-flag <組織の ID> [<機能> on|off [--execute]]");
  if (name !== undefined && onOff !== "on" && onOff !== "off") {
    throw new Error("使い方: feature-flag <組織の ID> <機能> on|off [--execute]");
  }
  const execute = flags.includes("--execute");
  const { db, pool } = createDb(migrationUrl);
  try {
    if (name === undefined) {
      const list = await showFeatureFlags(db, tenantId, FEATURE_FLAGS);
      process.stdout.write(`${JSON.stringify({ mode: "show", tenantId, flags: list })}\n`);
      return;
    }
    const change = await setFeatureFlag(db, tenantId, name, onOff === "on", {
      defs: FEATURE_FLAGS,
      execute,
    });
    const mode = !change.changed ? "unchanged" : execute ? "changed" : "plan";
    process.stdout.write(`${JSON.stringify({ mode, tenantId, ...change })}\n`);
    if (mode === "plan") {
      process.stdout.write(
        "まだ変えていません。組織と機能を確かめて --execute を付けて流してください\n",
      );
    }
  } finally {
    await pool.end();
  }
}

/** --name <値> の値。無ければ undefined */
const flagValue = (flags: string[], name: string): string | undefined => {
  const at = flags.indexOf(name);
  return at >= 0 ? flags[at + 1] : undefined;
};

/** none は null(上限なし・据え置きなし)。省けば undefined(決まりで埋める) */
function noneOr<T>(value: string | undefined, parse: (v: string) => T): T | null | undefined {
  if (value === undefined) return undefined;
  return value === "none" ? null : parse(value);
}

/** 組織の契約のプラン。--plan が無ければ見るだけ、--execute が無ければ試し。結果は JSON 1行(組織の名前は出さない) */
async function planCommand(args: string[]) {
  const [tenantId, ...flags] = args;
  if (!tenantId) throw new Error("使い方: plan <組織の ID> [--plan <プラン> … [--execute]]");
  const plan = flagValue(flags, "--plan");
  const { db, pool } = createDb(migrationUrl);
  try {
    if (plan === undefined) {
      process.stdout.write(
        `${JSON.stringify({ mode: "show", tenantId, ...(await showPlan(db, tenantId)) })}\n`,
      );
      return;
    }
    const input: PlanInput = {
      plan,
      priceList: flagValue(flags, "--price-list"),
      seats: noneOr(flagValue(flags, "--seats"), Number),
      priceLockedUntil: noneOr(flagValue(flags, "--locked-until"), (v) => v),
      effectiveOn: flagValue(flags, "--effective-on"),
    };
    const execute = flags.includes("--execute");
    const r = await setPlan(db, tenantId, input, {
      plans: PLANS,
      priceLists: PRICE_LISTS,
      execute,
    });
    const mode = !r.changed ? "unchanged" : execute ? "changed" : "plan";
    process.stdout.write(`${JSON.stringify({ mode, tenantId, ...r })}\n`);
    if (mode === "plan") {
      process.stdout.write(
        "まだ変えていません。組織と中身を確かめて --execute を付けて流してください\n",
      );
    }
  } finally {
    await pool.end();
  }
}

/** 全部の組織のプランを数える(読むだけ)。出すのは組織の ID と数だけ */
async function planReportCommand(args: string[]) {
  const days = Number(flagValue(args, "--within-days") ?? 60);
  if (!Number.isInteger(days) || days < 0) throw new Error("--within-days は0以上の整数");
  const { db, pool } = createDb(migrationUrl);
  try {
    const report = await planReport(db, {
      plans: PLANS,
      priceLists: PRICE_LISTS,
      withinDays: days,
      supportTenantId: process.env.SUPPORT_TENANT_ID ?? null,
    });
    process.stdout.write(`${JSON.stringify({ mode: "report", withinDays: days, ...report })}\n`);
  } finally {
    await pool.end();
  }
}

/** 利用の記録の集計・古い記録の削除(中身は src/usage/command.ts)。出すのは数だけ(組織の ID・名前・人の ID は出さない) */
async function usageCommand(run: (db: RootDb) => Promise<string[]>) {
  const { db, pool } = createDb(migrationUrl);
  try {
    for (const line of await run(db)) process.stdout.write(`${line}\n`);
  } finally {
    await pool.end();
  }
}

const commands = process.argv.slice(2);
if (commands.length === 0)
  throw new Error(
    "コマンドがありません(init-roles / migrate / seed / create-tenant / person-data / delete-tenant / legal-notify / feature-flag / plan / plan-report / usage-report / tenant-shares / usage-purge / pmf-survey-report / pmf-survey-purge)",
  );
// 数だけを出す運営のコマンド(中身は src/usage・src/pmf-survey。組織の ID・名前・人の ID は出さない)
const supportTenantId = process.env.SUPPORT_TENANT_ID ?? null;
const COUNT_COMMANDS: Record<string, (db: RootDb, args: string[]) => Promise<string[]>> = {
  "usage-report": (db, args) => runUsageReport(db, args, { defs: FEATURE_FLAGS, supportTenantId }),
  "tenant-shares": (db, args) => runTenantShares(db, args, { supportTenantId }),
  "usage-purge": (db, args) => runUsagePurge(db, args),
  "pmf-survey-report": (db, args) => runPmfSurveyReport(db, args, { supportTenantId }),
  "pmf-survey-purge": (db, args) => runPmfSurveyPurge(db, args),
};
const countCommand = COUNT_COMMANDS[commands[0] ?? ""];
if (countCommand) {
  await usageCommand((db) => countCommand(db, commands.slice(1)));
  process.exit(0);
}
if (commands[0] === "create-tenant") {
  await createTenantCommand(commands.slice(1));
  process.exit(0);
}
if (commands[0] === "person-data") {
  await personDataCommand(commands.slice(1));
  process.exit(0);
}
if (commands[0] === "delete-tenant") {
  await deleteTenantCommand(commands.slice(1));
  process.exit(0);
}
if (commands[0] === "plan") {
  await planCommand(commands.slice(1));
  process.exit(0);
}
if (commands[0] === "plan-report") {
  await planReportCommand(commands.slice(1));
  process.exit(0);
}
if (commands[0] === "feature-flag") {
  await featureFlagCommand(commands.slice(1));
  process.exit(0);
}
if (commands[0] === "legal-notify") {
  await legalNotifyCommand(commands.slice(1));
  process.exit(0);
}

for (const command of commands) {
  switch (command) {
    case "init-roles":
      await initRoles();
      break;
    case "migrate":
      await runMigrations(migrationUrl);
      break;
    case "seed":
      if (!throwaway) throw new Error(`${appEnv} に種データは入れません`);
      await seed(migrationUrl);
      break;
    default:
      throw new Error(`知らないコマンドです: ${command}`);
  }
  process.stdout.write(`${command}: done\n`);
}

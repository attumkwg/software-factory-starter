import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FEATURE_FLAGS, LegalDocumentSchema } from "@app/shared";
import pg from "pg";
import { createDb, type RootDb } from "./db/client.ts";
import { runMigrations } from "./db/migrate.ts";
import { seed } from "./db/seed.ts";
import {
  runPreRegistrationDelete,
  runPreRegistrationPurge,
  runPreRegistrationReport,
} from "./domains/growth/index.ts";
import { noticeProblem } from "./domains/legal/index.ts";
import { setFeatureFlag, showFeatureFlags } from "./feature-flags/index.ts";
import { notifyLegalChange } from "./legal-notify/notify.ts";
import { deleteTenant, planTenantDeletion } from "./offboarding/delete-tenant.ts";
import { runUsagePurge, runUsageReport } from "./usage/index.ts";

// 1回きりの作業の入口。ECS では同じイメージを command だけ変えて動かす。続けて書けば順に流す。
//   node dist/cli.js migrate          … 移行(表の持ち主で。MIGRATION_DATABASE_URL か PG* の環境変数)
//   node dist/cli.js seed             … 種データ(local / test / preview だけ)
//   node dist/cli.js init-roles       … 接続ユーザーを作る(使い捨ての DB だけ。SUPERUSER_DATABASE_URL)
//   node dist/cli.js init-roles migrate seed   … プレビュー環境の起動時
//   node dist/cli.js delete-tenant <組織の ID> [--execute --confirm-name <名前>]
//                                      … 解約した組織を消す(試し → 本番。docs/runbooks/offboarding.md)
//   node dist/cli.js legal-notify <文書> <版> [--execute]
//                                      … 規約の変更のお知らせを全員に積む(試し → 本番。docs/runbooks/legal-notice.md)
//   node dist/cli.js feature-flag <組織の ID> [<機能> on|off [--execute]]
//                                      … 組織に機能を入れる・切る(一覧 → 試し → 本番。docs/runbooks/feature-flags.md)
//   node dist/cli.js usage-report <機能> [--weeks <週の数>]
//                                      … 利用の記録を週ごとの数にする(読むだけ。docs/runbooks/usage-records.md)
//   node dist/cli.js usage-purge [--execute]
//                                      … 保存期間を過ぎた利用の記録を消す(試し → 本番。docs/runbooks/usage-records.md)
//   node dist/cli.js pre-registrations-report [--from YYYY-MM-DD] [--to YYYY-MM-DD]
//                                      … 公開の LP の来た所ごとの見た数・登録・確認と率(読むだけ。docs/runbooks/pre-registrations.md)
//   node dist/cli.js pre-registrations-purge [--execute]
//                                      … 消す日を過ぎた事前登録・古い日ごとの数を消す(試し → 本番)
//   node dist/cli.js pre-registrations-delete [--execute]
//                                      … 問い合わせのあったアドレスの事前登録を消す(アドレスは標準入力から1行。試し → 本番)

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

/** 利用の記録の集計・古い記録の削除(中身は src/usage/command.ts)。出すのは数だけ(組織の ID・名前・人の ID は出さない) */
async function usageCommand(run: (db: RootDb) => Promise<string[]>) {
  const { db, pool } = createDb(migrationUrl);
  try {
    for (const line of await run(db))
      process.stdout.write(`${line}
`);
  } finally {
    await pool.end();
  }
}

/** 事前登録のコマンド。運営の組織(SUPPORT_TENANT_ID)の持ち物なので、無ければ止める。出すのは数だけ */
async function preRegistrationCommand(
  run: (db: RootDb, operatorTenantId: string) => Promise<string[]>,
) {
  const operatorTenantId = process.env.SUPPORT_TENANT_ID;
  if (!operatorTenantId) throw new Error("SUPPORT_TENANT_ID(運営の組織)がありません");
  await usageCommand((db) => run(db, operatorTenantId));
}

/** 標準入力の最初の1行(メールアドレスをコマンドの引数に書かない = 端末の履歴に残さない) */
async function readLine(): Promise<string> {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.includes("\n")) break;
  }
  return input.split("\n")[0]?.trim() ?? "";
}

const commands = process.argv.slice(2);
if (commands.length === 0)
  throw new Error(
    "コマンドがありません(init-roles / migrate / seed / delete-tenant / legal-notify / feature-flag / usage-report / usage-purge / pre-registrations-report / pre-registrations-purge / pre-registrations-delete)",
  );
if (commands[0] === "usage-report") {
  const supportTenantId = process.env.SUPPORT_TENANT_ID ?? null;
  await usageCommand((db) =>
    runUsageReport(db, commands.slice(1), { defs: FEATURE_FLAGS, supportTenantId }),
  );
  process.exit(0);
}
if (commands[0] === "usage-purge") {
  await usageCommand((db) => runUsagePurge(db, commands.slice(1)));
  process.exit(0);
}
if (commands[0] === "pre-registrations-report") {
  await preRegistrationCommand((db, t) => runPreRegistrationReport(db, t, commands.slice(1)));
  process.exit(0);
}
if (commands[0] === "pre-registrations-purge") {
  await preRegistrationCommand((db, t) => runPreRegistrationPurge(db, t, commands.slice(1)));
  process.exit(0);
}
if (commands[0] === "pre-registrations-delete") {
  process.stderr.write("消す登録のメールアドレスを1行で入れてください: ");
  const email = await readLine();
  await preRegistrationCommand((db, t) =>
    runPreRegistrationDelete(db, t, email, commands.slice(1)),
  );
  process.exit(0);
}
if (commands[0] === "delete-tenant") {
  await deleteTenantCommand(commands.slice(1));
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

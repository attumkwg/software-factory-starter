import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LegalDocumentSchema } from "@app/shared";
import pg from "pg";
import { createDb } from "./db/client.ts";
import { runMigrations } from "./db/migrate.ts";
import { seed } from "./db/seed.ts";
import { noticeProblem, notifyLegalChange } from "./domains/legal/index.ts";
import { deleteTenant, planTenantDeletion } from "./offboarding/delete-tenant.ts";

// 1回きりの作業の入口。ECS では同じイメージを command だけ変えて動かす。続けて書けば順に流す。
//   node dist/cli.js migrate          … 移行(表の持ち主で。MIGRATION_DATABASE_URL か PG* の環境変数)
//   node dist/cli.js seed             … 種データ(local / test / preview だけ)
//   node dist/cli.js init-roles       … 接続ユーザーを作る(使い捨ての DB だけ。SUPERUSER_DATABASE_URL)
//   node dist/cli.js init-roles migrate seed   … プレビュー環境の起動時
//   node dist/cli.js delete-tenant <組織の ID> [--execute --confirm-name <名前>]
//                                      … 解約した組織を消す(試し → 本番。docs/runbooks/offboarding.md)
//   node dist/cli.js legal-notify <文書> <版> [--execute]
//                                      … 規約の変更のお知らせを全員に積む(試し → 本番。docs/runbooks/legal-notice.md)

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

const commands = process.argv.slice(2);
if (commands.length === 0)
  throw new Error(
    "コマンドがありません(init-roles / migrate / seed / delete-tenant / legal-notify)",
  );
if (commands[0] === "delete-tenant") {
  await deleteTenantCommand(commands.slice(1));
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

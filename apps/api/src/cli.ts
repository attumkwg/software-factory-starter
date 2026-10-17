import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runMigrations } from "./db/migrate.ts";
import { seed } from "./db/seed.ts";

// 1回きりの作業の入口。ECS では同じイメージを command だけ変えて動かす。続けて書けば順に流す。
//   node dist/cli.js migrate          … 移行(表の持ち主で。MIGRATION_DATABASE_URL か PG* の環境変数)
//   node dist/cli.js seed             … 種データ(local / test / preview だけ)
//   node dist/cli.js init-roles       … 接続ユーザーを作る(使い捨ての DB だけ。SUPERUSER_DATABASE_URL)
//   node dist/cli.js init-roles migrate seed   … プレビュー環境の起動時

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

const commands = process.argv.slice(2);
if (commands.length === 0) throw new Error("コマンドがありません(init-roles / migrate / seed)");

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

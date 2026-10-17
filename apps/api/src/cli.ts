import { runMigrations } from "./db/migrate.ts";
import { seed } from "./db/seed.ts";

// 1回きりの作業の入口。ECS では同じイメージを command だけ変えて動かす。
//   node dist/cli.js migrate   … 移行(表の持ち主の接続 MIGRATION_DATABASE_URL)
//   node dist/cli.js seed      … 種データ(local / preview だけ)

const command = process.argv[2];
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL がありません");

switch (command) {
  case "migrate":
    await runMigrations(url);
    break;
  case "seed": {
    const appEnv = process.env.APP_ENV ?? "local";
    if (appEnv === "stg" || appEnv === "prod") throw new Error(`${appEnv} に種データは入れません`);
    await seed(url);
    break;
  }
  default:
    throw new Error(`知らないコマンドです: ${command ?? "(なし)"}(migrate / seed)`);
}
process.stdout.write(`${command}: done\n`);

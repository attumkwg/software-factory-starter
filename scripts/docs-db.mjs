// DB の表の説明書(docs/db/)を tbls で作る。手元の docker compose の DB を読むだけ(書き込まない)。
//   pnpm docs:db
// 先に: docker compose up -d(移行まで済んでいること)
import { spawnSync } from "node:child_process";

const TBLS_IMAGE = "ghcr.io/k1low/tbls:v1.96.1";
// docker compose が作るネットワーク(compose の name: software-factory-starter から決まる)
const network = "software-factory-starter_default";

const r = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "--network",
    network,
    "-v",
    `${process.cwd()}:/work`,
    "-w",
    "/work",
    TBLS_IMAGE,
    "doc",
    "--force",
  ],
  { stdio: "inherit" },
);
if (r.status !== 0) {
  console.error("tbls が失敗しました。docker compose up -d で DB と移行を先に済ませてください。");
  process.exit(r.status ?? 1);
}

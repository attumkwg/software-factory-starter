// OpenAPI から全 API に「変な入力」を自動で送る(Schemathesis)。ロールごとにログインして叩く。
//   pnpm security:fuzz
// 相手は手元の docker compose(ログインは ALB の代わりの http://localhost:8080、叩くのは中の api:3000)だけ。種データが書き換わる・消えるので、
// 終わったら docker compose down -v && docker compose up -d で作り直す。
//
// 見つけるもの: 500(サーバーの失敗)・OpenAPI と違う応答・受け付けてはいけない入力を受け付けた、など。
// 見つけないもの: 「他社のデータが見える」のような意味の上の穴(それは権限の表のテストと人の診断)。

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync } from "node:fs";

const SCHEMATHESIS_IMAGE = "schemathesis/schemathesis:v4.30.1";
const NETWORK = "software-factory-starter_default";
const HOST_URL = "http://localhost:8080";
const IN_NETWORK_URL = "http://api:3000";
const MAX_EXAMPLES = process.env.FUZZ_MAX_EXAMPLES ?? "25";

const ACTORS = [
  { name: "admin", email: "admin@acme.test" },
  { name: "member", email: "member@acme.test" },
  { name: "viewer", email: "viewer@acme.test" },
  { name: "anonymous", email: null },
];

async function login(email) {
  const res = await fetch(`${HOST_URL}/api/auth/dev-login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: HOST_URL },
    body: JSON.stringify({ email }),
  });
  if (!res.ok)
    throw new Error(
      `ログインできません(${email}): ${res.status}。docker compose up -d は済んでいますか`,
    );
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

let failed = 0;
for (const actor of ACTORS) {
  const cookie = actor.email ? await login(actor.email) : null;
  const reportDir = `reports/schemathesis/${actor.name}`;
  mkdirSync(reportDir, { recursive: true });
  // Schemathesis のイメージは root でない利用者で動くので、手元(Actions)で作った置き場に書けるようにする
  chmodSync(reportDir, 0o777);
  console.log(`\n=== ${actor.name} ===`);

  const args = [
    "run",
    "--rm",
    "--network",
    NETWORK,
    "-v",
    `${process.cwd()}/reports:/reports`,
    SCHEMATHESIS_IMAGE,
    "run",
    `${IN_NETWORK_URL}/api/openapi.json`,
    "--url",
    IN_NETWORK_URL,
    // ブラウザと同じく Origin を付ける(付けないと CSRF の守りで 403 になる)
    "-H",
    `Origin: ${IN_NETWORK_URL}`,
    "--max-examples",
    MAX_EXAMPLES,
    "--checks",
    "not_a_server_error,status_code_conformance,content_type_conformance,response_schema_conformance",
    "--report",
    "junit",
    "--report-dir",
    `/reports/schemathesis/${actor.name}`,
  ];
  if (cookie) args.push("-H", `Cookie: ${cookie}`);

  const r = spawnSync("docker", args, { stdio: "inherit" });
  if (r.status !== 0) failed++;
}

if (failed > 0) {
  console.error(
    `\n${failed} 個のロールで問題が見つかりました。reports/schemathesis/ を見てください。`,
  );
  process.exit(1);
}
console.log("\n問題は見つかりませんでした。");

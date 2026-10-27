// テストか検査を弱めた PR を見つける(CI の「テストか検査を弱めていないか」。G-60・仕様 0062)。読むだけ。
//   CI: .github/workflows/test-weakening.yml が、土台のブランチの中身でこれを流し、見つかればラベル tests:weakened を付ける
//   手元で: PR_NUMBER=123 node scripts/test-weakening.mjs(`gh` でログインしておく)
// 見つけても落とさない(0 で終わる)。GitHub Actions の中では、found と要約を書き出す。
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { findWeakening, summarize } from "./test-weakening-lib.mjs";

const repo = process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY;
const number = process.env.PR_NUMBER;
if (!repo || !/^\d+$/.test(String(number))) {
  process.stderr.write("GH_REPO(か GITHUB_REPOSITORY)と PR_NUMBER を渡してください\n");
  process.exit(2);
}

const files = JSON.parse(
  execFileSync(
    "gh",
    ["api", "--paginate", "--slurp", `repos/${repo}/pulls/${number}/files?per_page=100`],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  ),
).flat();

const found = findWeakening(files);
const lines = summarize(found);
process.stdout.write(`${lines.join("\n")}\n`);
for (const x of found) process.stdout.write(`::warning file=${x.file}::${x.kind}: ${x.detail}\n`);

if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, `found=${found.length > 0}\n`);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## テストと検査\n\n${lines.join("\n")}\n`);

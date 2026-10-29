// 背景の AI が開いた PR の数を確かめる(G-62・仕様 0063。G-135・仕様 0095 で人を待つ本数と全体の本数の2つに)。読むだけ。
//   CI: claude.yml の前の段(秘密を持たないジョブ)が流す。上限に達していたら AI は動かない
//   手元で: GH_REPO=owner/repo AI_OPEN_PR_LIMIT=5 AI_OPEN_PR_TOTAL_LIMIT=20 node .github/scripts/ai-open-prs.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { judgeOpenPrs, limitOf, sensorsOnlyOf } from "./ai-open-prs-lib.mjs";

const repo = process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY;
if (!repo) {
  process.stderr.write("GH_REPO(か GITHUB_REPOSITORY)を渡してください\n");
  process.exit(2);
}

const prs = JSON.parse(
  execFileSync(
    "gh",
    ["api", "--paginate", "--slurp", `repos/${repo}/pulls?state=open&per_page=100`],
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  ),
).flat();

const { ok, line } = judgeOpenPrs({
  prs,
  limit: limitOf(process.env.AI_OPEN_PR_LIMIT, 5),
  totalLimit: limitOf(process.env.AI_OPEN_PR_TOTAL_LIMIT, 20),
  // main の設定を読む(PR の中で書き換えた値ではない。背景の AI は main のワークフローで動く)
  sensorsOnly: sensorsOnlyOf(readFileSync(".github/setup.yml", "utf8")),
});
process.stdout.write(`${ok ? "✅" : "❌"} ${line}\n`);
if (!ok) process.stdout.write(`::error::${line}\n`);
process.exit(ok ? 0 : 1);

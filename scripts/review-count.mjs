// 危険度「高」の PR の承認の人数を確かめる(CI の「危険度「高」の承認の人数」。G-43・仕様 0059)。
//   CI: .github/workflows/high-risk-approvals.yml が、土台のブランチの中身でこれを流す(PR で緩めて通すのを防ぐ)
//   手元で: PR_NUMBER=123 node scripts/review-count.mjs(`gh` でログインしておく。読むだけ)
// 人数は .github/setup.yml の ruleset.high_risk_approvals、「高」の場所は .claude/hooks/protected-paths.json。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { approvers, isHighRisk, judge, requiredFromSetup } from "./review-count-lib.mjs";

const repo = process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY;
const number = process.env.PR_NUMBER;
if (!repo || !/^\d+$/.test(String(number))) {
  process.stderr.write("GH_REPO(か GITHUB_REPOSITORY)と PR_NUMBER を渡してください\n");
  process.exit(2);
}

// 全部のページを1つの並びに
const api = (path) =>
  JSON.parse(
    execFileSync("gh", ["api", "--paginate", "--slurp", path], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }),
  ).flat();

const pr = JSON.parse(
  execFileSync("gh", ["api", `repos/${repo}/pulls/${number}`], { encoding: "utf8" }),
);
const files = api(`repos/${repo}/pulls/${number}/files?per_page=100`);
const reviews = api(`repos/${repo}/pulls/${number}/reviews?per_page=100`);
const labels = (pr.labels ?? []).map((l) => l.name);
const { paths } = JSON.parse(readFileSync(".claude/hooks/protected-paths.json", "utf8"));
const required = requiredFromSetup(readFileSync(".github/setup.yml", "utf8"));

const high = isHighRisk({ files, labels, paths });
const approved = approvers({ reviews, author: pr.user?.login });
const { ok, message } = judge({ high, required, approved });
process.stdout.write(`${ok ? "✅" : "❌"} ${message}\n`);
process.exit(ok ? 0 : 1);

// PR で未確定事項を人の答え(承認・変更・保留・導入時に決める)に変えた行が、人の書いたコメントかレビューを
// 指しているかを確かめる(CI の「未確定事項の答えの出どころ」。G-61・仕様 0061)。
//   CI: .github/workflows/decision-evidence.yml が、土台のブランチの中身でこれを流す(PR で緩めて通すのを防ぐ)
//   手元で: PR_NUMBER=123 node scripts/decision-evidence.mjs(`gh` でログインしておく。読むだけ)
// 書き方は docs/guides/human-review.md の 2。中身は decisions-lib.mjs。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  changedAnswers,
  conversationAnswerOf,
  conversationAnswerProblems,
  evidenceOf,
  evidenceProblems,
  soloFrom,
} from "./decisions-lib.mjs";

const repo = process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY;
const number = Number(process.env.PR_NUMBER);
if (!repo || !Number.isInteger(number) || number <= 0) {
  process.stderr.write("GH_REPO(か GITHUB_REPOSITORY)と PR_NUMBER を渡してください\n");
  process.exit(2);
}

const gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const api = (path) => JSON.parse(gh(["api", "--paginate", "--slurp", path])).flat();
const one = (path) => {
  try {
    return JSON.parse(gh(["api", path]));
  } catch {
    return undefined;
  }
};
// PR の側の中身(土台のブランチを checkout しているので、PR の側は API で読む)
const headText = (path, sha) =>
  gh([
    "api",
    "-H",
    "Accept: application/vnd.github.raw",
    `repos/${repo}/contents/${path}?ref=${sha}`,
  ]);
// 土台の側の中身(checkout した物。無ければ新しい設計書)
const baseText = (path) => (path && existsSync(path) ? readFileSync(path, "utf8") : "");

const ITEM_PATH = {
  comment: (e) => `repos/${repo}/issues/comments/${e.id}`,
  review: (e) => `repos/${repo}/pulls/${e.number}/reviews/${e.id}`,
  review_comment: (e) => `repos/${repo}/pulls/comments/${e.id}`,
};

const pr = JSON.parse(gh(["api", `repos/${repo}/pulls/${number}`]));
const designs = api(`repos/${repo}/pulls/${number}/files?per_page=100`).filter(
  (f) =>
    f.status !== "removed" &&
    f.filename.startsWith("docs/designs/") &&
    f.filename.endsWith(".md") &&
    !f.filename.split("/").pop().startsWith("_"),
);

// 1人の間は、持ち主が会話(Slack・チャット)で返した答えも認める(仕様 0080。土台のブランチの setup.yml で決める)
const solo = soloFrom(baseText(".github/setup.yml"));
const owner = repo.split("/")[0];

const problems = [];
const ok = [];
for (const f of designs) {
  const head = headText(f.filename, pr.head.sha).replaceAll("\r\n", "\n");
  const base = baseText(f.previous_filename ?? f.filename).replaceAll("\r\n", "\n");
  const designNumber = f.filename.split("/").pop().slice(0, 4);
  for (const row of changedAnswers(base, head)) {
    const evidence = evidenceOf(row.state);
    if (!evidence && conversationAnswerOf(row.state)) {
      const found = conversationAnswerProblems({ row, solo, owner });
      if (found.length > 0) problems.push(...found.map((p) => `${f.filename} ${p}`));
      else
        ok.push(
          `${f.filename} ${row.id}: @${owner} の会話の答え(1人の間。CI は書き手を確かめない)`,
        );
      continue;
    }
    const item =
      evidence && evidence.repo.toLowerCase() === repo.toLowerCase()
        ? one(ITEM_PATH[evidence.type](evidence))
        : undefined;
    const found = evidenceProblems({ row, evidence, item, repo, prNumber: number, designNumber });
    if (found.length > 0) problems.push(...found.map((p) => `${f.filename} ${p}`));
    else ok.push(`${f.filename} ${row.id}: @${item.user.login} の答え(${evidence.url})`);
  }
}

for (const line of ok) process.stdout.write(`✅ ${line}\n`);
if (problems.length > 0) {
  process.stdout.write(
    `❌ 人の答えの出どころが確かめられない行があります(AI は人の答えを書けない。docs/guides/human-review.md の 2):\n${problems.map((p) => `- ${p}`).join("\n")}\n`,
  );
  process.exit(1);
}
if (ok.length === 0) process.stdout.write("✅ この PR で人の答えに変わった未確定事項は無い\n");

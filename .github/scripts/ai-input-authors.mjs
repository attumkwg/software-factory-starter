// 背景の AI(claude.yml)に読ませる Issue・PR の書き手を確かめる(G-58・仕様 0060)。読むだけ。
//   CI: claude.yml の前の段(秘密を持たないジョブ)が流す。落ちたら AI は動かない
//   手元で: GH_REPO=owner/repo EVENT_NAME=workflow_dispatch PROMPT="Issue #12 を直して" node .github/scripts/ai-input-authors.mjs
import { execFileSync } from "node:child_process";
import { judge, MAX_TARGETS, targetsOf, untrustedIn } from "./ai-input-authors-lib.mjs";

const repo = process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY;
if (!repo) {
  process.stderr.write("GH_REPO(か GITHUB_REPOSITORY)を渡してください\n");
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
const one = (path) => JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8" }));

const targets = targetsOf({
  eventName: process.env.EVENT_NAME,
  prompt: process.env.PROMPT,
  issueNumber: process.env.ISSUE_NUMBER,
});

const found = [];
for (const number of targets.length <= MAX_TARGETS ? targets : []) {
  const issue = one(`repos/${repo}/issues/${number}`);
  const items = [
    { kind: "本文", ...issue },
    ...api(`repos/${repo}/issues/${number}/comments?per_page=100`).map((c) => ({
      kind: "コメント",
      ...c,
    })),
  ];
  if (issue.pull_request) {
    items.push(
      ...api(`repos/${repo}/pulls/${number}/reviews?per_page=100`).map((r) => ({
        kind: "レビュー",
        ...r,
      })),
      ...api(`repos/${repo}/pulls/${number}/comments?per_page=100`).map((c) => ({
        kind: "レビューのコメント",
        ...c,
      })),
    );
  }
  found.push({ number, untrusted: untrustedIn(items) });
}

const { ok, lines } = judge({ targets, found });
const [head, ...rest] = lines;
process.stdout.write(`${ok ? "✅" : "❌"} ${head}\n${rest.map((l) => `  ${l}\n`).join("")}`);
if (!ok) process.stdout.write(`::error::${head}\n`);
process.exit(ok ? 0 : 1);

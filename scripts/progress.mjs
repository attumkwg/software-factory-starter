// 依頼ごとの進み具合の管制: 開いている親 Issue(印 kind:feature)ごとに n/m・依存の順番・完成の判定・止まった PR を出す(仕様 0086)。
//   pnpm progress           手元に出す(Markdown)
//   pnpm progress --json    JSON で出す
//   pnpm progress --write   親 Issue の本文の「📍 進み具合」の囲いを直す。progress.yml が毎朝と、子の Issue・PR が閉じたときに流す
// 完成 = 子が全部閉じた+受け入れの記録(docs/acceptance/*.md)の頭に「親 Issue: #番号」がある。
// 依頼から届くまでの日数 = 親 Issue を開いた日から、受け入れの最後の回の日まで(北極星の入力。docs/kit/roadmap.md の 4)。
// 読むのは gh api(REST)。書くのは --write のときの親 Issue の本文だけ。
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { todayInTokyo } from "./checkup/phase.mjs";
import {
  acceptanceOf,
  childrenOf,
  progressOf,
  renderBlock,
  renderSummary,
  withBlock,
} from "./progress-lib.mjs";

const args = process.argv.slice(2);
const gh = (list, input) =>
  execFileSync("gh", list, { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
const api = (path) => JSON.parse(gh(["api", "--paginate", "--slurp", path])).flat();
const repo =
  process.env.GH_REPO ??
  process.env.GITHUB_REPOSITORY ??
  gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
const now = new Date();
const today = todayInTokyo(now);

// 受け入れの記録(親 Issue の番号 → 最後の回)
const accepted = new Map();
const ACCEPTANCE = "docs/acceptance";
if (existsSync(ACCEPTANCE)) {
  for (const f of readdirSync(ACCEPTANCE).filter((x) => x.endsWith(".md") && !x.startsWith("_"))) {
    const path = join(ACCEPTANCE, f).replaceAll("\\", "/");
    const a = acceptanceOf(readFileSync(path, "utf8"));
    if (a.parent && a.date) accepted.set(a.parent, { path, date: a.date });
  }
}

// 開いている親と、8週のうちに閉じた親(届くまでの日数の中央値に入れる)
const since = new Date(now.getTime() - 56 * 24 * 3600 * 1000).toISOString();
const parents = [
  ...api(`repos/${repo}/issues?state=open&labels=kind:feature&per_page=100`),
  ...api(`repos/${repo}/issues?state=closed&labels=kind:feature&since=${since}&per_page=100`),
].filter((i) => !i.pull_request && childrenOf(i.body).length > 0);
const prs = api(`repos/${repo}/pulls?state=open&per_page=100`).map((p) => ({
  number: p.number,
  body: p.body ?? "",
  updated_at: p.updated_at,
  draft: p.draft,
}));
const issueCache = new Map();
const issueOf = (n) => {
  if (!issueCache.has(n)) {
    const i = JSON.parse(gh(["api", `repos/${repo}/issues/${n}`]));
    issueCache.set(n, { state: i.state, closed_at: i.closed_at, created_at: i.created_at });
  }
  return issueCache.get(n);
};

const list = parents.map((parent) => {
  const issues = new Map();
  for (const c of childrenOf(parent.body)) issues.set(c.number, issueOf(c.number));
  return {
    p: progressOf({ parent, issues, prs, accepted: accepted.get(parent.number), now }),
    parent,
  };
});
const openList = list.filter((x) => x.parent.state === "open");

if (args.includes("--json"))
  console.log(
    JSON.stringify(
      list.map((x) => x.p),
      null,
      2,
    ),
  );
else
  console.log(
    renderSummary(
      openList.map((x) => x.p),
      today,
      list.map((x) => x.p),
    ),
  );

if (args.includes("--write")) {
  for (const { p, parent } of openList) {
    const body = withBlock(parent.body, renderBlock(p, today));
    if (body === parent.body) continue;
    gh(["issue", "edit", String(p.number), "--repo", repo, "--body-file", "-"], body);
  }
}

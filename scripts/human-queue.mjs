// 人の判断待ちの積み場: 人の答えを待つ PR・Issue・意義の判断を、古い順に1枚に出す(仕様 0085)。
//   pnpm queue            手元に出す(Markdown)
//   pnpm queue --json     JSON で出す
//   pnpm queue --issue    「🧑‍⚖️ 判断待ち」の Issue を1つだけ作る・直す(無くなったら閉じる)。human-queue.yml が毎朝流す
//   pnpm queue --slack    SLACK_WEBHOOK_URL があれば同じ本文を送る(任意)
// 待っている物: 下書きでない開いた PR のうち、印(needs-human・risk:high・tests:weakened)か本文の「🧑‍⚖️」の表に問いがあり、
// まだ会話の答えの記録(「## 持ち主の承認(会話で」のコメント)が無い物・印 needs-human の Issue・期限を過ぎて人の判定が未定の意義の判断。
// 読むのは gh api(REST)。人が決めることの一覧は docs/concepts/human-decisions.md。
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { todayInTokyo } from "./checkup/phase.mjs";
import {
  hasAnswer,
  prQuestions,
  QUEUE_ISSUE_TITLE,
  QUEUE_LABELS,
  queueItems,
  renderQueue,
} from "./human-queue-lib.mjs";
import { parseVerdict } from "./verdict-lib.mjs";

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

const prs = api(`repos/${repo}/pulls?state=open&per_page=100`).map((p) => ({
  number: p.number,
  title: p.title,
  draft: p.draft,
  labels: (p.labels ?? []).map((l) => l.name),
  body: p.body ?? "",
  created_at: p.created_at,
}));
// 答えの記録はコメントにあるので、待っていそうな PR だけ読む
for (const pr of prs) {
  if (pr.draft) continue;
  const flagged =
    pr.labels.some((l) => QUEUE_LABELS.includes(l)) || prQuestions(pr.body).length > 0;
  if (flagged)
    pr.answered = hasAnswer(api(`repos/${repo}/issues/${pr.number}/comments?per_page=100`));
}
const issues = api(`repos/${repo}/issues?state=open&labels=needs-human&per_page=100`)
  .filter((i) => !i.pull_request && i.title !== QUEUE_ISSUE_TITLE)
  .map((i) => ({ number: i.number, title: i.title, created_at: i.created_at }));

const verdicts = [];
for (const dir of ["docs/product/verdicts", "docs/kit/verdicts"]) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".md") && !x.startsWith("_"))) {
    const path = join(dir, f).replaceAll("\\", "/");
    const md = readFileSync(path, "utf8");
    const v = parseVerdict(md);
    const waits = (v.verdict === "やる" || v.verdict === "条件つき") && v.by && v.by <= today;
    if (waits && v.judged === "未定")
      verdicts.push({ path, title: md.match(/^# (.+)$/m)?.[1] ?? f, by: `${v.by}T00:00:00+09:00` });
  }
}

const items = queueItems({ prs, issues, verdicts, now });
const text = renderQueue(items, today);

if (args.includes("--json")) console.log(JSON.stringify({ today, items }, null, 2));
else console.log(text);

if (args.includes("--issue")) {
  const open = api(`repos/${repo}/issues?state=open&labels=needs-human&per_page=100`).find(
    (i) => !i.pull_request && i.title === QUEUE_ISSUE_TITLE,
  );
  if (items.length === 0 && open) {
    gh([
      "issue",
      "close",
      String(open.number),
      "--repo",
      repo,
      "--comment",
      "判断待ちが無くなった",
    ]);
  } else if (items.length > 0 && open) {
    gh(["issue", "edit", String(open.number), "--repo", repo, "--body-file", "-"], text);
  } else if (items.length > 0) {
    gh(
      [
        "issue",
        "create",
        "--repo",
        repo,
        "--title",
        QUEUE_ISSUE_TITLE,
        "--label",
        "needs-human",
        "--body-file",
        "-",
      ],
      text,
    );
  }
}

if (args.includes("--slack") && process.env.SLACK_WEBHOOK_URL && items.length > 0) {
  const res = await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) console.error(`Slack に送れなかった(HTTP ${res.status})。Issue は書けている`);
}

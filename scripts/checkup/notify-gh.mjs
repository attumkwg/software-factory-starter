// 知らせを gh で書く(Issue を作る・直す・閉じる・ラベル)。中身と何をするかは notify.mjs が決める。
// 書くのは Issue だけ(コードは書かない)。トークンはジョブの GITHUB_TOKEN(issues: write)。
// Slack の Webhook(SLACK_WEBHOOK_URL)があれば、同じ要約を送る(任意。設計書 3.・5.)。
import { execFileSync } from "node:child_process";
import { LABEL, planUrgent, planWeekly, URGENT_LABEL } from "./notify.mjs";
import { headline } from "./report.mjs";

const LABELS = [
  { name: LABEL, color: "0e8a16", description: "点検(pnpm checkup の知らせ)" },
  { name: URGENT_LABEL, color: "b60205", description: "点検の急ぎ(守りが外れた・重い穴・漏れ)" },
];

/** gh を流す。input は標準入力(本文) */
function gh(args, input) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 60_000,
  }).trim();
}

const list = (repo, label, state) =>
  JSON.parse(
    gh([
      "issue",
      "list",
      "--repo",
      repo,
      "--label",
      label,
      "--state",
      state,
      "--limit",
      "30",
      "--json",
      "number,title,body,state",
    ]) || "[]",
  );

const login = (handle) => String(handle ?? "").replace("@", "");

/** Issue を作る。担当者を assign できなければ assign なしで作り直す(戻り値は URL と assign できたか) */
function create(repo, action, assignee) {
  const labels = action.urgent ? `${LABEL},${URGENT_LABEL}` : LABEL;
  const base = ["issue", "create", "--repo", repo, "--title", action.title, "--label", labels];
  try {
    return {
      url: gh([...base, "--assignee", login(assignee), "--body-file", "-"], action.body),
      assigned: true,
    };
  } catch {
    return { url: gh([...base, "--body-file", "-"], action.body), assigned: false };
  }
}

function apply(repo, action, assignee) {
  if (action.type === "create") return create(repo, action, assignee);
  if (action.type === "edit") {
    gh(["issue", "edit", String(action.number), "--repo", repo, "--body-file", "-"], action.body);
    return { url: `https://github.com/${repo}/issues/${action.number}` };
  }
  gh(["issue", "close", String(action.number), "--repo", repo, "--comment", action.comment]);
  return {};
}

async function slack(text, env = process.env) {
  const url = env.SLACK_WEBHOOK_URL;
  if (!url) return;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) console.error(`Slack に送れなかった(HTTP ${res.status})。Issue は書けている`);
}

function ensureLabels(repo) {
  for (const l of LABELS)
    gh([
      "label",
      "create",
      l.name,
      "--repo",
      repo,
      "--color",
      l.color,
      "--description",
      l.description,
      "--force",
    ]);
}

/** 毎週の Issue を作る・直す。前の週の Issue を閉じる */
async function weekly(repo, run, owners) {
  const issues = list(repo, LABEL, "all");
  let actions = planWeekly({ run, issues, responder: owners.responder, advisor: owners.advisor });
  let created =
    actions[0].type === "create" ? create(repo, actions[0], owners.responder) : undefined;
  if (created && !created.assigned) {
    // assign できなかったときは、本文の先頭で担当者を @ で呼ぶ
    actions = planWeekly({
      run,
      issues,
      responder: owners.responder,
      advisor: owners.advisor,
      assigned: false,
    });
    const n = created.url.split("/").at(-1);
    apply(repo, { type: "edit", number: n, body: actions[0].body });
  }
  created ??= apply(repo, actions[0]);
  for (const a of actions.slice(1)) apply(repo, a);
  console.log(`毎週の点検: ${created.url}`);
  await slack([...headline(run), created.url].join("\n"));
}

/** 急ぎの Issue を作る・直す・直った物を閉じる */
async function urgent(repo, run, owners) {
  const actions = planUrgent({ run, issues: list(repo, URGENT_LABEL, "open") });
  for (const a of actions) {
    const r = apply(repo, a, owners.responder);
    console.log(`急ぎ: ${a.type} ${r.url ?? `#${a.number}`}`);
    if (a.type === "create") await slack(`🔴 ${a.title}\n${r.url}`);
  }
  if (actions.length === 0) console.log("急ぎ: なし");
}

/** pnpm checkup --issue / --urgent の書く所 */
export async function notify(run, { repo, owners, weekly: doWeekly, urgent: doUrgent }) {
  if (!repo) throw new Error("知らせるリポジトリが分からない(GITHUB_REPOSITORY か gh repo view)");
  ensureLabels(repo);
  if (doWeekly) await weekly(repo, run, owners);
  if (doUrgent) await urgent(repo, run, owners);
}

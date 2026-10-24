// 知らせ(GitHub の Issue)の中身と、何をするか(作る・直す・閉じる)を決める。gh で書くのは notify-gh.mjs。
// 決まりは docs/designs/0007-checkup.md の 3.(Issue の形)。台帳には書かない(点検のジョブはコードを書かない)。
import { addDays } from "./phase.mjs";
import { footer, headline, reportSections } from "./report.mjs";
import { urgentOf } from "./runner.mjs";

export const LABEL = "checkup";
export const URGENT_LABEL = "checkup-urgent";
const WEEKLY_MARK = "<!-- checkup:weekly ids=";
const URGENT_MARK = "<!-- checkup:urgent id=";

const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO の週(月曜始まり)。「2026-W43」 */
export function isoWeek(date) {
  const d = new Date(`${date}T00:00:00Z`);
  const weekday = (d.getUTCDay() + 6) % 7; // 月曜 = 0
  const thursday = addDays(date, 3 - weekday); // その週の木曜が入る年が、週の年
  const year = Number(thursday.slice(0, 4));
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstMonday = firstThursday.getTime() - ((firstThursday.getUTCDay() + 6) % 7) * DAY_MS;
  const week = Math.floor((d.getTime() - firstMonday) / (7 * DAY_MS)) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export const weeklyTitle = (today) => `点検 ${isoWeek(today)}`;
export const urgentTitle = (item) => `点検の急ぎ: ${item.title}`;

/** 印の後ろ(「-->」の手前まで)を取り出す。無ければ undefined */
function markValue(body, mark) {
  const text = String(body ?? "");
  const at = text.lastIndexOf(mark);
  if (at < 0) return undefined;
  const end = text.indexOf("-->", at);
  return end < 0 ? undefined : text.slice(at + mark.length, end).trim();
}

export const isWeekly = (issue) => markValue(issue.body, WEEKLY_MARK) !== undefined;
export const weeklyIdsOf = (issue) =>
  (markValue(issue.body, WEEKLY_MARK) ?? "").split(",").filter((s) => s.length > 0);
export const urgentIdOf = (issue) => markValue(issue.body, URGENT_MARK);

/** 今週まだ残っている項目(聞く・手でやる・落ちた・確かめられなかった)の id */
export function pendingIds(run) {
  const open = run.results.filter((r) => r.result !== "pass").map((r) => r.item.id);
  return [...new Set([...run.ask.map((i) => i.id), ...run.manual.map((i) => i.id), ...open])];
}

const itemsById = (run) =>
  new Map([...run.results.map((r) => r.item), ...run.ask, ...run.manual].map((i) => [i.id, i]));

/** 毎週の Issue の本文。carried は先週から残っている項目の id */
export function weeklyBody(run, { carried = [], responder, advisor, assigned = true } = {}) {
  const byId = itemsById(run);
  const carriedLines = carried.map((id) => `- ${byId.get(id)?.title ?? id} \`${id}\``);
  return [
    ...headline(run).map((l) => `- ${l}`),
    ...(assigned || !responder ? [] : ["", `${responder} さん、今週の点検です。`]),
    ...(carriedLines.length === 0 ? [] : ["", "## ↩️ 先週から残っているもの", "", ...carriedLines]),
    ...reportSections(run, { issue: true, advisor }),
    "",
    "---",
    "答え方: Claude Code で `/checkup` と打つと、1問ずつ聞かれます(答えは台帳に書かれ、PR になります)。",
    "チェックボックスは「やった」の印だけです。`/checkup` があなたに確かめてから台帳に書きます(この Issue のコメントは答えとして扱いません)。",
    "",
    footer(run),
    "",
    `${WEEKLY_MARK}${pendingIds(run).join(",")} -->`,
    "",
  ].join("\n");
}

/** 急ぎの Issue の本文 */
export function urgentBody(r, today) {
  const back = r.regressed ? "【守りが外れた】" : "";
  return [
    `🔴 ${back}${r.item.title}`,
    "",
    `- なぜ急ぎか: ${r.item.why}`,
    `- 放っておくと: ${r.item.if_ignored}`,
    `- いまの結果: ${r.note}(最後に確かめた日: ${today})`,
    "- どうするか: Claude Code で `/checkup`(急ぎの話から始まります)",
    "",
    "毎日確かめ直し、直ったらこの Issue は自動で閉じます。中身(脆弱性・漏れた物)はこの Issue に書きません。",
    "",
    `${URGENT_MARK}${r.item.id} -->`,
    "",
  ].join("\n");
}

/**
 * 毎週の知らせで何をするか。issues は点検のラベルの Issue(開いた・閉じたの両方。{ number, title, body, state })
 * 戻り値: [{ type: "create", title, body } | { type: "edit", number, body } | { type: "close", number, comment }]
 */
export function planWeekly({ run, issues, responder, advisor, assigned = true }) {
  const title = weeklyTitle(run.today);
  const weekly = issues.filter(isWeekly);
  const current = weekly.find((i) => i.title === title && i.state === "OPEN");
  const previous = weekly.filter((i) => i.title !== title).sort((a, b) => b.number - a.number)[0];
  const now = new Set(pendingIds(run));
  const carried = previous ? weeklyIdsOf(previous).filter((id) => now.has(id)) : [];
  const body = weeklyBody(run, { carried, responder, advisor, assigned });
  const actions = [
    current ? { type: "edit", number: current.number, body } : { type: "create", title, body },
  ];
  for (const old of weekly)
    if (old.state === "OPEN" && old.title !== title)
      actions.push({
        type: "close",
        number: old.number,
        comment: `次の週の点検(${title})に写しました。`,
      });
  return actions;
}

/**
 * 急ぎの知らせで何をするか。issues は急ぎのラベルの開いた Issue
 * 急ぎ1件 = 1つの Issue。開いていれば本文だけ直す。pass に戻った物は閉じる(unknown は閉じない)
 */
export function planUrgent({ run, issues }) {
  const actions = [];
  const open = new Map(issues.filter((i) => i.state === "OPEN").map((i) => [urgentIdOf(i), i]));
  for (const r of urgentOf(run)) {
    const body = urgentBody(r, run.today);
    const existing = open.get(r.item.id);
    actions.push(
      existing
        ? { type: "edit", number: existing.number, body }
        : { type: "create", title: urgentTitle(r.item), body, urgent: true },
    );
  }
  for (const [id, issue] of open) {
    const r = run.results.find((x) => x.item.id === id);
    if (r?.result === "pass")
      actions.push({
        type: "close",
        number: issue.number,
        comment: `${run.today} に確かめたら直っていました(${r.note})。`,
      });
  }
  return actions;
}

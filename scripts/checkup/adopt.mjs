// 台帳を「使い始めた人の物」にする中身。CLI は adopt-cli.mjs(pnpm checkup:adopt)。
// キットから作ったリポジトリでは、台帳の使い始めた日・担当者・状態がキットの持ち主のままなので、使い始める前に一度だけ流す。
//   - started_on を今日に・owners を自分に・refreshed_on を消す(まだ一度も取り込んでいない)
//   - 引退していない項目: status を open に・snoozed_until を消す・history に adopted を1行足す(足すだけ。消さない)
//   - 引退した項目は触らない(キットが「もう要らない」と決めた記録)
// 台帳は YAML の文書の形のまま書き戻す(コメント・並び・書き方を崩さない)。決まり: docs/designs/0014-setup-before-use.md の 6.
import { isMap, isSeq, parseDocument } from "yaml";

export const ADOPTED_NOTE = "キットから使い始めた(ここより前の記録はキットの持ち主の物)";

const handle = (s) => {
  const t = String(s ?? "").trim();
  return t.startsWith("@") ? t : `@${t}`;
};

/** history に1行足す(1行ずつの { } で) */
function appendHistory(doc, node, entry) {
  let history = node.get("history", true);
  if (!isSeq(history)) {
    history = doc.createNode([]);
    node.set("history", history);
  }
  history.flow = false;
  const e = doc.createNode(entry);
  e.flow = true;
  history.items.push(e);
}

/**
 * 台帳の文を書き換えた文と、変えた項目の数を返す。
 * by … 担当者(@名前)/ advisor … 相談先(無ければ by)/ today … YYYY-MM-DD
 */
export function adoptLedger(text, { by, advisor, today }) {
  const doc = parseDocument(text);
  const responder = handle(by);
  doc.set("started_on", today);
  doc.setIn(["owners", "responder"], responder);
  doc.setIn(["owners", "advisor"], handle(advisor ?? by));
  if (doc.has("refreshed_on")) doc.delete("refreshed_on");
  let reset = 0;
  for (const node of doc.get("items")?.items ?? []) {
    if (!isMap(node) || node.get("status") === "retired") continue;
    node.set("status", "open");
    node.delete("snoozed_until");
    appendHistory(doc, node, { on: today, by: responder, result: "adopted", note: ADOPTED_NOTE });
    reset += 1;
  }
  return { text: doc.toString({ lineWidth: 0 }), reset };
}

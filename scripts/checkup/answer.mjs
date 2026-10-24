// 答え1つを台帳に書く中身(状態の変え方と、足すだけの記録)。CLI は answer-cli.mjs。/checkup が呼ぶ。
// 決まりは docs/designs/0007-checkup.md の 2.(question.options[].after・history)・4.(状態遷移)・6.(一問一答)。
// 台帳は YAML の文書の形のまま書き戻す(コメント・並び・書き方を崩さない)。
import { isMap, isSeq, parseDocument } from "yaml";
import { addDays, isDate, toDate } from "./phase.mjs";
import { SNOOZE_MAX_DAYS } from "./todo.mjs";

/** 答えの種類(/checkup の選択肢) */
export const KINDS = ["pick", "unsure", "snooze", "did", "could-not"];

const handle = (s) => {
  const t = String(s ?? "")
    .trim()
    .toLowerCase();
  return t.startsWith("@") ? t : `@${t}`;
};

/** 答えてよい人か(ふつうは担当者・相談先に回った項目は相談先だけ) */
function whoMayAnswer(ledger, item) {
  return item.status === "asked_advisor"
    ? { role: "相談先", login: ledger.owners?.advisor }
    : { role: "担当者", login: ledger.owners?.responder };
}

const fail = (error) => ({ error });

/** 選んだ後の状態(選択肢の after。書かなければ done) */
function afterPick(option, today, checkResult) {
  const after = option.after ?? "done";
  if (after === "snooze")
    return { status: "snoozed", snoozed_until: addDays(today, SNOOZE_MAX_DAYS) };
  if (after === "open") return { status: "open" };
  if (checkResult?.result === "fail") return { status: "open" };
  return { status: "done" };
}

const checkNote = (checkResult) =>
  checkResult ? `確かめ: ${checkResult.result}(${checkResult.note})` : undefined;

const RULES = {
  pick(item, a) {
    if (item.verify !== "ask") return fail(`${item.id} は人に聞く項目ではない(選ぶのは ask だけ)`);
    const option = (item.question?.options ?? []).find((o) => o.label === a.choice);
    if (!option) return fail(`${item.id} に選択肢「${a.choice}」が無い`);
    return {
      ...afterPick(option, a.today, a.checkResult),
      entry: { result: "answered", choice: option.label, note: a.note ?? checkNote(a.checkResult) },
    };
  },
  unsure(item) {
    if (item.status === "asked_advisor")
      return fail("相談先は「分からない」を選べない(答えるか、今はやらない)");
    const q = item.question;
    const entry =
      item.verify === "ask" && !q.irreversible
        ? { result: "unsure", choice: q.recommended, note: "おすすめで仮に進め、相談先に回した" }
        : {
            result: "unsure",
            note:
              item.verify === "ask"
                ? "戻せない問い(お金・公開・削除・契約)なので進めず、相談先に回した"
                : "相談先に回した",
          };
    return { status: "asked_advisor", entry };
  },
  snooze(_item, a) {
    if (!isDate(a.until)) return fail("次に聞く日(--snooze)は YYYY-MM-DD");
    if (a.until <= a.today) return fail("次に聞く日は今日より後");
    if (a.until > addDays(a.today, SNOOZE_MAX_DAYS))
      return fail(`次に聞く日は今日から${SNOOZE_MAX_DAYS}日まで`);
    if (!a.note) return fail("今はやらない理由(--note)が要る");
    return {
      status: "snoozed",
      snoozed_until: a.until,
      entry: { result: "snoozed", note: a.note },
    };
  },
  did(item, a) {
    if (item.verify !== "manual")
      return fail(`${item.id} は人が手でやる項目ではない(やったは manual だけ)`);
    const failed = a.checkResult?.result === "fail";
    return {
      status: failed ? "open" : "done",
      entry: { result: "did", note: a.note ?? checkNote(a.checkResult) },
    };
  },
  "could-not"(item, a) {
    if (item.verify !== "manual") return fail(`${item.id} は人が手でやる項目ではない`);
    if (!a.note) return fail("できなかった理由(--note)が要る");
    return { status: "open", entry: { result: "could_not", note: a.note } };
  },
};

/**
 * 答え1つから、次の状態と history の1行を決める。台帳はまだ書かない。
 * answer: { id, by, kind, choice?, until?, note?, today, checkResult? }
 * 戻り値: { status, snoozed_until?, entry } か { error }
 */
export function decide(ledger, answer) {
  const item = (ledger.items ?? []).find((i) => i.id === answer.id);
  if (!item) return fail(`台帳に ${answer.id} が無い`);
  if (item.status === "retired") return fail(`${item.id} は引退した項目`);
  if (item.verify === "auto")
    return fail(`${item.id} は自動で確かめる項目(答えずに pnpm checkup で見る)`);
  if (!KINDS.includes(answer.kind)) return fail(`答えの種類は ${KINDS.join(" / ")} のどれか`);
  const may = whoMayAnswer(ledger, item);
  if (!may.login || handle(answer.by) !== handle(may.login))
    return fail(`${item.id} に答えられるのは${may.role}(${may.login})だけ(いま: ${answer.by})`);
  const r = RULES[answer.kind](item, answer);
  if (r.error) return r;
  const entry = { on: answer.today, by: handle(answer.by), ...r.entry };
  for (const k of Object.keys(entry)) if (entry[k] === undefined) delete entry[k];
  return { ...r, entry };
}

/** 状態を置く(snoozed_until は status のすぐ後ろ。要らなくなったら消す) */
function setStatus(node, status, until) {
  node.set("status", status);
  if (until === undefined) {
    node.delete("snoozed_until");
    return;
  }
  if (node.has("snoozed_until")) {
    node.set("snoozed_until", until);
    return;
  }
  const at = node.items.findIndex((p) => p.key?.value === "status");
  node.set("snoozed_until", until);
  const pair = node.items.pop();
  node.items.splice(at + 1, 0, pair);
}

/** 台帳の文に、決めた答えを書き戻す(コメント・並びはそのまま。history は1行ずつの { } で足す) */
export function writeAnswer(text, id, decision) {
  const doc = parseDocument(text);
  const node = doc.get("items")?.items?.find((n) => isMap(n) && n.get("id") === id);
  if (!node) throw new Error(`台帳に ${id} が無い`);
  setStatus(node, decision.status, decision.snoozed_until);
  let history = node.get("history", true);
  if (!isSeq(history)) {
    history = doc.createNode([]);
    node.set("history", history);
  }
  history.flow = false;
  const entry = doc.createNode(decision.entry);
  entry.flow = true;
  history.items.push(entry);
  return doc.toString({ lineWidth: 0 });
}

/** 画面に出す1行 */
export const describe = (id, d) =>
  `${id}: ${d.status}${d.snoozed_until ? `(${toDate(d.snoozed_until)} にまた聞く)` : ""} — ${d.entry.result}${d.entry.choice ? `「${d.entry.choice}」` : ""}`;

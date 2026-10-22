// 点検の台帳(docs/checkup/todo.yaml)を読み、書き方を確かめ、いま見る項目を選ぶ。CLI は run.mjs。
// 決まりは docs/designs/0007-checkup.md の 2.(データモデル)・4.(状態遷移)・6.(業務ルール)。
import { parse } from "yaml";
import { addDays, EVERY_DAYS, isDate, PHASES, reached, toDate } from "./phase.mjs";

export const FILE = "docs/checkup/todo.yaml";
export const WHO = ["system", "ai", "human"];
export const VERIFY = ["auto", "ask", "manual"];
export const SEVERITY = ["high", "normal"];
export const STATUS = ["open", "done", "asked_advisor", "snoozed", "retired"];
const REQUIRED = [
  "id",
  "title",
  "why",
  "if_ignored",
  "who",
  "phase",
  "every",
  "verify",
  "severity",
  "status",
  "source",
  "review_by",
];
const SNOOZE_MAX_DAYS = 90;

const isKebab = (s) =>
  typeof s === "string" &&
  s.length > 0 &&
  [...s].every((c) => (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === "-");

export const loadLedger = (text) => parse(text);

function checkEnums(item, name, problems) {
  const enums = [
    ["who", WHO],
    ["phase", PHASES.map((p) => p.id)],
    ["every", Object.keys(EVERY_DAYS)],
    ["verify", VERIFY],
    ["severity", SEVERITY],
    ["status", STATUS],
  ];
  for (const [key, values] of enums)
    if (item[key] !== undefined && !values.includes(item[key]))
      problems.push(`${name} の ${key}「${item[key]}」は ${values.join(" / ")} のどれか`);
}

function checkQuestion(q, name, problems) {
  if (!q?.text) return problems.push(`${name} は ask なので question.text が要る`);
  const labels = (q.options ?? []).map((o) => o?.label);
  if (labels.length < 2 || labels.length > 4)
    problems.push(`${name} の選択肢は2〜4個(いま ${labels.length})`);
  for (const o of q.options ?? [])
    if (!o?.label || !o?.means) problems.push(`${name} の選択肢に label と means が要る`);
  if (!labels.includes(q.recommended))
    problems.push(`${name} のおすすめ「${q.recommended}」が選択肢に無い`);
  if (typeof q.irreversible !== "boolean")
    problems.push(`${name} の question.irreversible は true か false`);
}

/** 確かめ方ごとに要る欄(auto → check・ask → question・manual → steps) */
function checkVerify(item, name, checkNames, problems) {
  if (item.verify === "auto") {
    if (!item.check) problems.push(`${name} は auto なので check が要る`);
    else if (checkNames && !checkNames.includes(item.check))
      problems.push(`${name} の check「${item.check}」が scripts/checkup/checks/ に無い`);
  }
  if (item.verify === "ask") checkQuestion(item.question, name, problems);
  if (item.verify === "manual" && !(Array.isArray(item.steps) && item.steps.length > 0))
    problems.push(`${name} は manual なので steps(番号付きの手順)が要る`);
}

function checkDates(item, name, problems) {
  if (item.review_by !== undefined && !isDate(toDate(item.review_by)))
    problems.push(`${name} の review_by は YYYY-MM-DD`);
  if (!Array.isArray(item.history)) problems.push(`${name} の history は一覧([] でもよい)`);
  for (const h of item.history ?? [])
    if (!isDate(toDate(h?.on)) || !h?.by || !h?.result)
      problems.push(`${name} の history の1行に on(YYYY-MM-DD)・by・result が要る`);
  if (item.status === "snoozed") {
    const until = toDate(item.snoozed_until);
    const last = toDate(lastEntry(item)?.on);
    if (!isDate(until)) problems.push(`${name} は snoozed なので snoozed_until が要る`);
    else if (isDate(last) && until > addDays(last, SNOOZE_MAX_DAYS))
      problems.push(`${name} の snoozed_until は最後の記録から${SNOOZE_MAX_DAYS}日まで`);
  }
}

function checkItem(item, checkNames, problems) {
  const name = `項目 ${item?.id ?? "(id なし)"}`;
  for (const f of REQUIRED) if (!item?.[f]) problems.push(`${name} に ${f} が無い`);
  if (item?.id !== undefined && !isKebab(item.id))
    problems.push(`${name} の id は英小文字・数字・ハイフンだけ`);
  checkEnums(item ?? {}, name, problems);
  checkVerify(item ?? {}, name, checkNames, problems);
  checkDates(item ?? {}, name, problems);
}

/**
 * 台帳の書き方を確かめ、問題の一覧を返す(空なら合格)。
 * checkNames を渡すと、auto の check が実在するかも見る。
 */
export function validateLedger(ledger, checkNames) {
  const problems = [];
  if (!isDate(toDate(ledger?.started_on))) problems.push("started_on(使い始めた日)が無い");
  if (!ledger?.owners?.responder) problems.push("owners.responder(担当者)が無い");
  if (!ledger?.owners?.advisor) problems.push("owners.advisor(相談先)が無い");
  const ids = new Set();
  for (const item of ledger?.items ?? []) {
    if (ids.has(item?.id)) problems.push(`項目 ${item.id} が2回ある`);
    ids.add(item?.id);
    checkItem(item, checkNames, problems);
  }
  return problems;
}

/** いちばん新しい記録(足すだけなので最後の行) */
export const lastEntry = (item) => (item.history ?? []).at(-1);

/** 人に聞く・人がやる項目が、今週もう一度出てくるか(定期の項目で、前の記録から間隔が過ぎた) */
const dueAgain = (item, today) => {
  const days = EVERY_DAYS[item.every];
  const last = lastEntry(item);
  if (days === undefined || !last) return false;
  return addDays(toDate(last.on), days) <= today;
};

/**
 * いまの段階に当たる項目を、扱いごとに分ける(取り残しも残す。飛ばして次に行かない)。
 *   checks   … auto。台帳の状態にかかわらず毎回確かめ直す(書いてある状態を信じない)
 *   ask      … 担当者に聞く(open・または定期で間隔が過ぎた done・日が来た snoozed)
 *   manual   … 担当者が手でやる(同じ)
 *   advisor  … 「分からない」で相談先に回っている
 *   snoozed  … 「今はやらない」で、次に聞く日がまだ来ていない
 *   done     … 済み(人に聞く・人がやる項目で、まだ間隔が来ていない)
 */
export function selectItems(ledger, currentPhase, today) {
  const out = { checks: [], ask: [], manual: [], advisor: [], snoozed: [], done: [] };
  for (const item of ledger.items ?? []) {
    if (item.status === "retired" || !reached(item.phase, currentPhase)) continue;
    out[bucketOf(item, today)].push(item);
  }
  return out;
}

/** 1件をどの扱いに入れるか(selectItems の中身) */
function bucketOf(item, today) {
  if (item.verify === "auto") return "checks";
  if (item.status === "asked_advisor") return "advisor";
  if (item.status === "snoozed" && toDate(item.snoozed_until) > today) return "snoozed";
  if (item.status === "done" && !dueAgain(item, today)) return "done";
  return item.verify === "ask" ? "ask" : "manual";
}

/** 見直す日が来た・過ぎた項目(w-ledger) */
export const reviewDue = (ledger, today) =>
  (ledger.items ?? []).filter(
    (i) => i.status !== "retired" && i.review_by && toDate(i.review_by) <= today,
  );

/**
 * 記録が足すだけになっているか(前の版の history が、後の版の history の頭にそのまま残っているか)。
 * 項目そのものは消さずに retired にするので、前の版にあった id が消えていても問題にする。
 */
export function historyAppendOnly(before, after) {
  const problems = [];
  const afterById = new Map((after?.items ?? []).map((i) => [i.id, i]));
  for (const old of before?.items ?? []) {
    const now = afterById.get(old.id);
    if (!now) {
      problems.push(`項目 ${old.id} が消えている(消さずに status: retired にする)`);
      continue;
    }
    const prev = JSON.stringify(old.history ?? []);
    const head = JSON.stringify((now.history ?? []).slice(0, (old.history ?? []).length));
    if (prev !== head) problems.push(`項目 ${old.id} の history が書き換わっている(足すだけ)`);
  }
  return problems;
}

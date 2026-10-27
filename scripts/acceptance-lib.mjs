// 受け入れの記録(docs/acceptance/NNNN-*.md)と解決済みの論点(docs/domain/resolved-questions.md)を読む中身。
// 入口は acceptance.mjs。書き方は docs/guides/acceptance.md・設計は docs/designs/0075-acceptance-record.md。
// Semgrep の regex_dos に当たらないよう、正規表現を使わずに読む(decisions-lib.mjs と同じ)。
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** PdM にしか判断できない観点(PdM が見るのはこの4つだけ) */
export const PDM_VIEWS = ["流れ", "ルール", "作り込み", "仮決め"];
/** 網羅が要る観点(AI と QA が見る) */
export const SWEEP_VIEWS = ["状態", "境界値", "権限", "URL", "スマホ", "a11y", "プラン", "その他"];
export const WHO = ["PdM", "AI", "QA"];
export const RESULTS = ["合", "否", "未"];
export const REASONS = ["要求", "設計", "AI の仮決め", "実装"];

const isDigits = (s) => s.length > 0 && [...s].every((c) => c >= "0" && c <= "9");
const isDate = (s) => {
  const [y, m, d] = s.split("-");
  return (
    s.length === 10 && y?.length === 4 && m?.length === 2 && d?.length === 2 && isDigits(y + m + d)
  );
};

// 表の1行(| … |)をセルに分ける。表の行でなければ undefined
const cellsOf = (raw) => {
  const line = raw.trim();
  if (!line.startsWith("|") || !line.endsWith("|")) return undefined;
  return line
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
};

// 「R-3」「R-12」を文の中から全部取り出す
export const resolvedIdsIn = (text) => {
  const ids = [];
  let at = text.indexOf("R-");
  while (at >= 0) {
    let end = at + 2;
    while (end < text.length && isDigits(text[end])) end += 1;
    if (end > at + 2) ids.push(text.slice(at, end));
    at = text.indexOf("R-", end);
  }
  return ids;
};

/** 解決済みの論点の番号(R-n)の集まり。番号が重なっていれば problems に */
export function readResolved(text, path = "docs/domain/resolved-questions.md") {
  const ids = new Set();
  const problems = [];
  text.split("\n").forEach((raw, i) => {
    const cells = cellsOf(raw);
    const id = cells?.[0] ?? "";
    if (!id.startsWith("R-") || !isDigits(id.slice(2))) return;
    if (ids.has(id)) problems.push(`${path}:${i + 1} 論点の番号 ${id} が重なっている`);
    ids.add(id);
  });
  return { ids, problems };
}

// 「## 第2回 2026-10-28」から回と日付を取り出す。回の見出しでなければ undefined
const roundOf = (raw) => {
  if (!raw.startsWith("## 第")) return undefined;
  const rest = raw.slice(4);
  const at = rest.indexOf("回");
  if (at <= 0 || !isDigits(rest.slice(0, at))) return undefined;
  return { no: Number(rest.slice(0, at)), date: rest.slice(at + 1).trim() };
};

// 観点と見る人の組み合わせの問題(PdM の4つ ⇔ PdM)
const viewProblems = ({ view, who }) => {
  const pdmView = PDM_VIEWS.includes(view);
  const out = [];
  if (!pdmView && !SWEEP_VIEWS.includes(view)) out.push(`観点「${view}」は決まった言葉でない`);
  if (!WHO.includes(who)) out.push(`見る人「${who}」は PdM / AI / QA のどれでもない`);
  else if (pdmView && who !== "PdM")
    out.push(`観点「${view}」は PdM にしか判断できない(見る人を PdM に)`);
  else if (!pdmView && who === "PdM")
    out.push(`観点「${view}」は網羅の確かめなので PdM に回さない(AI か QA に)`);
  return out;
};

// 外れた理由と書き戻し先の問題(否 のときだけ理由が要る・要求なら R-n が要る)
const reasonProblems = ({ result, reason, backTo }, resolved) => {
  if (!RESULTS.includes(result)) return [`結果「${result}」は 合 / 否 / 未 のどれでもない`];
  if (result !== "否") return reason === "" ? [] : ["合・未 の項目に外れた理由を書かない"];
  const out = [];
  if (!REASONS.includes(reason))
    out.push("外れた理由が 要求 / 設計 / AI の仮決め / 実装 のどれでもない");
  const ids = resolvedIdsIn(backTo);
  if (reason === "要求" && ids.length === 0)
    out.push("要求のせいの外れに、書き戻した論点(R-n)が無い");
  for (const id of ids) if (!resolved.has(id)) out.push(`論点 ${id} が解決済みの論点に無い`);
  return out;
};

// 回の見出しの日付の問題(前の回より前に戻らない)
const dateProblem = (date, lastDate) => {
  if (!isDate(date)) return "回の見出しの日付が YYYY-MM-DD でない";
  return date < lastDate ? "前の回より前の日付になっている" : undefined;
};

// 1つの記録を読む。回の見出しより前の表は読まない
const readFile = (path, text, resolved, problems) => {
  const rounds = [];
  let lastDate = "";
  text.split("\n").forEach((raw, i) => {
    const where = `${path}:${i + 1}`;
    const head = roundOf(raw);
    if (head) {
      const p = dateProblem(head.date, lastDate);
      if (p) problems.push(`${where} ${p}`);
      if (isDate(head.date)) lastDate = head.date;
      rounds.push({ path, no: head.no, date: head.date, items: [], where });
      return;
    }
    const cells = cellsOf(raw);
    const round = rounds.at(-1);
    if (!round || !cells || !isDigits(cells[0])) return;
    const [, view = "", who = "", , result = "", reason = "", backTo = ""] = cells;
    const row = { view, who, result, reason, backTo };
    for (const p of [...viewProblems(row), ...reasonProblems(row, resolved)])
      problems.push(`${where} ${p}`);
    round.items.push({ who, view, result, reason });
  });
  return rounds;
};

/**
 * 受け入れの記録を読む。files: [{ path, text }]・resolved: 論点の番号の集まり。
 * 返す rounds: [{ path, no, date, items: [{ who, view, result, reason }] }]・problems: 文の配列
 */
export function readAcceptance(files, resolved = new Set()) {
  const problems = [];
  const rounds = files.flatMap(({ path, text }) => readFile(path, text, resolved, problems));
  for (const r of rounds)
    if (r.items.length === 0) problems.push(`${r.where} 項目が1つも無い(空の回は作らない)`);
  return { rounds: rounds.map(({ where, ...r }) => r), problems };
}

// 合 ÷(合+否)。分母が0なら undefined(0% にしない)
const rate = (items) => {
  const ok = items.filter((i) => i.result === "合").length;
  const ng = items.filter((i) => i.result === "否").length;
  return ok + ng === 0 ? undefined : ok / (ok + ng);
};

/** 1回の点数(PdM・AI と QA・全体)と、外れた理由の内訳 */
export function scoreOf(round) {
  const reasons = Object.fromEntries(REASONS.map((r) => [r, 0]));
  for (const i of round.items) if (i.result === "否" && i.reason in reasons) reasons[i.reason] += 1;
  return {
    pdm: rate(round.items.filter((i) => i.who === "PdM")),
    sweep: rate(round.items.filter((i) => i.who !== "PdM")),
    all: rate(round.items),
    pdmItems: round.items.filter((i) => i.who === "PdM").length,
    items: round.items.length,
    reasons,
  };
}

export const percent = (v) => (v === undefined ? "—" : `${Math.round(v * 100)}%`);

export const RESOLVED_PATH = "docs/domain/resolved-questions.md";
export const ACCEPTANCE_DIR = "docs/acceptance";

/** リポジトリの今の記録を読む(pnpm acceptance・テストの「今の記録」・pnpm metrics が使う) */
export function readRepoAcceptance(root = ".") {
  const at = (p) => join(root, p);
  const resolved = readResolved(
    existsSync(at(RESOLVED_PATH)) ? readFileSync(at(RESOLVED_PATH), "utf8") : "",
    RESOLVED_PATH,
  );
  const files = existsSync(at(ACCEPTANCE_DIR))
    ? readdirSync(at(ACCEPTANCE_DIR))
        .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
        .sort()
        .map((f) => ({
          path: `${ACCEPTANCE_DIR}/${f}`,
          text: readFileSync(at(`${ACCEPTANCE_DIR}/${f}`), "utf8"),
        }))
    : [];
  const read = readAcceptance(files, resolved.ids);
  return { rounds: read.rounds, problems: [...resolved.problems, ...read.problems] };
}

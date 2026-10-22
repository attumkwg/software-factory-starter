// 部品のカタログ(docs/kit/catalog.yaml)を読み、書き方とつながりを確かめる。CLI は catalog.mjs。
// ファイルの有無は引数の exists / read で受け取る(テストで差し替えるため)。
import { parse } from "yaml";

export const STATUSES = ["あり", "作成中", "未", "消した"];
export const DEFAULTS = ["残す", "消す"];
export const DECISIONS = ["残す", "消す", "後で決める"];
const PART_FIELDS = ["id", "name", "group", "status", "removable", "default", "what"];
const PART_TEXTS = ["needed_by", "not_needed_by", "if_removed"];
const STEP_FIELDS = ["title", "does", "status"];
const QUESTION_FIELDS = ["id", "text", "kind", "options", "recommended", "why"];
const KINDS = ["事業判断", "利用者の挙動", "他チームとの契約や制約", "戻せないリスク"];

const isKebab = (s) =>
  typeof s === "string" &&
  s.length > 0 &&
  [...s].every((c) => (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === "-");

export function loadCatalog(text) {
  return parse(text);
}

/** 「audience=個人向け」を { question, option } に */
const splitCondition = (cond) => {
  const at = String(cond).indexOf("=");
  return at < 0
    ? { question: cond, option: "" }
    : { question: cond.slice(0, at), option: cond.slice(at + 1) };
};

function checkStep(step, i, problems) {
  for (const f of STEP_FIELDS) if (!step?.[f]) problems.push(`start_steps[${i}] に ${f} が無い`);
  if (step?.status && !STATUSES.includes(step.status))
    problems.push(
      `start_steps[${i}] の status「${step.status}」は ${STATUSES.join(" / ")} のどれか`,
    );
}

function checkQuestion(q, problems) {
  for (const f of QUESTION_FIELDS)
    if (q?.[f] === undefined) problems.push(`質問 ${q?.id} に ${f} が無い`);
  if (q?.kind && !KINDS.includes(q.kind))
    problems.push(
      `質問 ${q.id} の kind「${q.kind}」は人に聞く4つのどれでもない(4つに当たらないなら聞かずに決める)`,
    );
  if (Array.isArray(q?.options) && !q.options.includes(q.recommended))
    problems.push(`質問 ${q.id} のおすすめ「${q.recommended}」が選択肢に無い`);
}

/** 欄が埋まっているか(必須の欄・文の欄・一覧の欄) */
function checkPresence(part, name, problems) {
  for (const f of PART_FIELDS) if (part?.[f] === undefined) problems.push(`${name} に ${f} が無い`);
  for (const f of PART_TEXTS) if (!part?.[f]) problems.push(`${name} に ${f} が無い`);
  for (const f of ["depends_on", "law"])
    if (!Array.isArray(part?.[f])) problems.push(`${name} の ${f} は一覧([] でもよい)`);
}

/** 値が決まった物のどれかか */
function checkValues(part, name, groupIds, problems) {
  if (!isKebab(part?.id)) problems.push(`${name} の id は英小文字・数字・ハイフンだけ`);
  if (part?.group && !groupIds.has(part.group))
    problems.push(`${name} の group「${part.group}」が groups に無い`);
  if (part?.status && !STATUSES.includes(part.status))
    problems.push(`${name} の status「${part.status}」は ${STATUSES.join(" / ")} のどれか`);
  if (part?.default && !DEFAULTS.includes(part.default))
    problems.push(`${name} の default は 残す / 消す のどちらか`);
}

function checkFields(part, groupIds, problems) {
  const name = `部品 ${part?.id ?? "(id なし)"}`;
  checkPresence(part, name, problems);
  checkValues(part, name, groupIds, problems);
}

/** 土台(removable: false)は消す答えにならないこと */
function checkFoundation(part, problems) {
  if (part.removable !== false) return;
  const name = `土台 ${part.id}`;
  if (part.default !== "残す") problems.push(`${name} の default は 残す だけ`);
  if (part.status === "消した") problems.push(`${name} は消せない(status: 消した になっている)`);
  if (part.remove) problems.push(`${name} に消し方(remove)は書かない`);
  if (part.suggest_remove_when?.length) problems.push(`${name} に suggest_remove_when は書かない`);
}

function checkConditions(part, questions, problems) {
  for (const key of ["suggest_remove_when", "keep_when"]) {
    for (const cond of part[key] ?? []) {
      const { question, option } = splitCondition(cond);
      const q = questions.get(question);
      if (!q) problems.push(`部品 ${part.id} の ${key}「${cond}」の質問 ${question} が無い`);
      else if (!q.options.includes(option))
        problems.push(`部品 ${part.id} の ${key}「${cond}」の答え ${option} が選択肢に無い`);
    }
  }
}

/** 消し方に書いたファイル・フォルダが実在するか */
function missingPaths(r, fsx) {
  const paths = [
    ...(r.delete ?? []),
    ...(r.edit ?? []).map((e) => e.path),
    ...(r.docs ?? []),
    ...(r.terraform ?? []).map((t) => t.file),
    ...(r.ci ?? []).map((c) => c.file),
  ];
  return paths.filter((p) => !fsx.exists(p)).map((p) => `${p} が無い`);
}

/** 消し方に書いた Terraform のモジュール・CI のジョブ・権限の表の行が、ファイルの中にあるか */
function missingInside(r, fsx) {
  const missing = [];
  const has = (file, text) => fsx.exists(file) && fsx.read(file).includes(text);
  for (const t of r.terraform ?? [])
    if (t.module && !has(t.file, `module "${t.module}"`))
      missing.push(`${t.file} に module "${t.module}" が無い`);
  for (const c of r.ci ?? [])
    if (
      !has(
        c.file,
        `
  ${c.job}:`,
      )
    )
      missing.push(`${c.file} にジョブ ${c.job} が無い`);
  for (const route of r.matrix ?? [])
    if (
      !has(
        "docs/authz/matrix.yaml",
        `route: ${route}
`,
      )
    )
      missing.push(`権限の表に ${route} が無い`);
  return missing;
}

/** 消し方に書いた物が、いまのリポジトリに実在するか(「あり」の部品だけ) */
function checkRemoval(part, fsx, problems) {
  if (part.removable !== true || part.status !== "あり") return;
  const name = `部品 ${part.id} の消し方`;
  const r = part.remove;
  if (!r || !(r.delete?.length || r.edit?.length || r.terraform?.length)) {
    problems.push(`${name}(remove の delete / edit / terraform)が無い`);
    return;
  }
  for (const m of [...missingPaths(r, fsx), ...missingInside(r, fsx)])
    problems.push(`${name}: ${m}`);
}

function checkWhere(part, fsx, problems) {
  if (part.status !== "あり") return;
  for (const p of part.where ?? [])
    if (!fsx.exists(p)) problems.push(`部品 ${part.id} の where: ${p} が無い`);
}

/** 先頭の欄(版・始め方・質問) */
function checkHead(catalog, problems) {
  if (catalog?.version !== 1) problems.push("version: 1 が無い");
  for (const [i, s] of (catalog?.start_steps ?? []).entries()) checkStep(s, i, problems);
  const questions = new Map((catalog?.questions ?? []).map((q) => [q.id, q]));
  for (const q of questions.values()) checkQuestion(q, problems);
  return questions;
}

/** 書き方・つながり・消し方を確かめ、問題の一覧を返す(空なら合格) */
export function validateCatalog(catalog, fsx) {
  const problems = [];
  const questions = checkHead(catalog, problems);
  const groupIds = new Set((catalog?.groups ?? []).map((g) => g.id));
  const parts = catalog?.parts ?? [];
  const ids = new Set();
  for (const part of parts) {
    if (ids.has(part?.id)) problems.push(`部品 ${part.id} が2回ある`);
    ids.add(part?.id);
    checkFields(part, groupIds, problems);
  }
  for (const part of parts) {
    for (const dep of part.depends_on ?? [])
      if (!ids.has(dep)) problems.push(`部品 ${part.id} が頼っている ${dep} がカタログに無い`);
    checkFoundation(part, problems);
    checkConditions(part, questions, problems);
    checkRemoval(part, fsx, problems);
    checkWhere(part, fsx, problems);
  }
  const removed = new Set(parts.filter((p) => p.status === "消した").map((p) => p.id));
  problems.push(...checkRemovedSet(parts, removed));
  return problems;
}

/** 頼られている(この部品に頼っている部品の id) */
export function dependentsOf(catalog, id) {
  return (catalog.parts ?? []).filter((p) => (p.depends_on ?? []).includes(id)).map((p) => p.id);
}

/** 消す部品の集まりが、土台を含まない・残す部品が頼っていないか */
export function checkRemovedSet(parts, removed) {
  const problems = [];
  for (const p of parts) {
    if (removed.has(p.id) && p.removable === false)
      problems.push(`土台 ${p.id} を消す答えになっている`);
    if (removed.has(p.id) || p.status === "未") continue;
    for (const dep of p.depends_on ?? [])
      if (removed.has(dep))
        problems.push(`${dep} を消すと、残す ${p.id} が困る(${p.id} が頼っている)`);
  }
  return problems;
}

/**
 * 記録(docs/product/tailoring.md)の表の行「| id | 部品 | 決定 | 理由 |」から、部品ごとの最新の決定を読む。
 * 記録は足すだけなので、後ろの行が新しい。
 */
export function readDecisions(text, knownIds) {
  const decisions = new Map();
  const problems = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("|") || !line.endsWith("|")) continue;
    const cells = line
      .slice(1, -1)
      .split("|")
      .map((c) => c.trim());
    if (!isKebab(cells[0]) || !DECISIONS.includes(cells[2])) continue;
    if (!knownIds.has(cells[0])) problems.push(`記録の部品 ${cells[0]} がカタログに無い`);
    decisions.set(cells[0], cells[2]);
  }
  return { decisions, problems };
}

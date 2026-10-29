// セットアップの設定(.github/setup.yml)とラベルの一覧(.github/labels.yml)を読み、書き方を確かめる。
// 決まり: docs/designs/0014-setup-before-use.md の 2.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { GUIDE_FIELDS } from "./labels-doc.mjs";

export const SETUP_FILE = ".github/setup.yml";
export const LABELS_FILE = ".github/labels.yml";
/** 必須のチェックを付けてよい App(GitHub Actions)。ほかの App が同じ名前の状態を付けても通さない */
export const ACTIONS_APP_ID = 15368;
/** 公開のリポジトリでだけ使える守り(非公開は有料) */
export const PUBLIC_ONLY = [
  "secret_scanning",
  "push_protection",
  "private_vulnerability_reporting",
];

const isHex = (s) =>
  typeof s === "string" &&
  s.length === 6 &&
  [...s.toLowerCase()].every((c) => "0123456789abcdef".includes(c));

export function loadConfig(root = process.cwd()) {
  const read = (f) => parse(readFileSync(join(root, f), "utf8"));
  return { setup: read(SETUP_FILE), labels: read(LABELS_FILE)?.labels ?? [] };
}

/** ラベル1つの書き方の問題 */
function labelProblems(l, i) {
  const at = l?.name ? `ラベル ${l.name}` : `labels[${i}]`;
  const problems = [];
  if (!l?.name) problems.push(`${at} に name が無い`);
  if (!isHex(l?.color)) problems.push(`${at} の color は6桁の16進(# なし)`);
  if (!l?.description) problems.push(`${at} に description が無い`);
  else if ([...l.description].length > 100) problems.push(`${at} の description は100文字まで`);
  for (const f of GUIDE_FIELDS)
    if (!l?.[f]) problems.push(`${at} に ${f} が無い(手引き docs/guides/labels.md に出す)`);
  return problems;
}

/** ラベルの一覧の書き方の問題(名前の重なりは大文字と小文字を区別しない。GitHub と同じ) */
export function validateLabels(labels) {
  const problems = [];
  const seen = new Set();
  for (const [i, l] of (labels ?? []).entries()) {
    problems.push(...labelProblems(l, i));
    const key = String(l?.name ?? "").toLowerCase();
    if (key && seen.has(key)) problems.push(`ラベル ${l.name} が2回ある`);
    seen.add(key);
  }
  return problems;
}

function environmentProblems(envs) {
  const problems = [];
  const names = new Set();
  for (const env of envs ?? []) {
    if (!env?.name) problems.push("environments に name の無い物がある");
    else if (names.has(env.name)) problems.push(`environments の ${env.name} が2回ある`);
    names.add(env?.name);
    if (!Array.isArray(env?.branches) || env.branches.length === 0)
      problems.push(`environments の ${env?.name} に branches が無い`);
  }
  return problems;
}

/** 危険度「高」の承認の人数(仕様 0059)。書かなければ 0 */
function highRiskApprovalsProblems(ruleset) {
  const high = ruleset?.high_risk_approvals;
  if (high === undefined) return [];
  if (!(Number.isInteger(high) && high >= 0 && high <= 6))
    return ["ruleset.high_risk_approvals は 0〜6 の整数"];
  if (high > 0 && high < (ruleset?.required_approvals ?? 0))
    return ["ruleset.high_risk_approvals は required_approvals 以上(高のほうが多く要る)"];
  return [];
}

/** マージキューで使ってよいマージの方法(直線の履歴なので MERGE は使わない) */
export const QUEUE_MERGE_METHODS = { SQUASH: "squash", REBASE: "rebase" };
const QUEUE_NUMBERS = [
  ["max_entries_to_build", 1, 100],
  ["max_entries_to_merge", 1, 100],
  ["min_entries_to_merge", 1, 100],
  ["min_entries_to_merge_wait_minutes", 0, 360],
  ["check_response_timeout_minutes", 1, 360],
];

/** マージキュー(G-135・仕様 0095)。書かなければ扱わない(画面で足した物を残す) */
function mergeQueueProblems(ruleset) {
  const q = ruleset?.merge_queue;
  if (q === undefined) return [];
  const at = "ruleset.merge_queue";
  const problems = [];
  if (typeof q?.enabled !== "boolean") problems.push(`${at}.enabled は true か false`);
  const method = QUEUE_MERGE_METHODS[q?.merge_method];
  if (!method) problems.push(`${at}.merge_method は SQUASH か REBASE`);
  else if (!(ruleset.allowed_merge_methods ?? []).includes(method))
    problems.push(`${at}.merge_method(${q.merge_method})が allowed_merge_methods に無い`);
  for (const [key, min, max] of QUEUE_NUMBERS)
    if (!(Number.isInteger(q?.[key]) && q[key] >= min && q[key] <= max))
      problems.push(`${at}.${key} は ${min}〜${max} の整数`);
  if (Number.isInteger(q?.min_entries_to_merge) && q.min_entries_to_merge > q.max_entries_to_merge)
    problems.push(`${at}.min_entries_to_merge は max_entries_to_merge 以下`);
  if (q?.grouping_strategy !== "ALLGREEN")
    problems.push(`${at}.grouping_strategy は ALLGREEN(まとめた全部が緑のときだけ入れる)`);
  if (q?.enabled === true && ruleset.strict !== false)
    problems.push(
      `${at}.enabled が true なら ruleset.strict は false(キューが最新の main に重ねて確かめる。追いつき直しが残ると流量が上がらない)`,
    );
  return problems;
}

/** AI のマージで返事を待たない範囲(G-135・ADR 0094)。書かなければ false */
function aiMergeProblems(aiMerge) {
  if (aiMerge === undefined) return [];
  return typeof aiMerge?.sensors_only === "boolean"
    ? []
    : ["ai_merge.sensors_only は true か false"];
}

/** 設定の書き方の問題 */
export function validateSetup(setup) {
  const problems = [];
  if (setup?.version !== 1) problems.push("version は 1");
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(setup?.template_repository ?? "")))
    problems.push("template_repository は owner/name");
  const checks = setup?.ruleset?.required_checks;
  const listed = Array.isArray(checks) && checks.length > 0;
  if (!listed || checks.some((c) => typeof c !== "string"))
    problems.push("ruleset.required_checks は名前の並び(1つ以上)");
  if (!setup?.ruleset?.name) problems.push("ruleset.name が無い");
  problems.push(...highRiskApprovalsProblems(setup?.ruleset));
  problems.push(...mergeQueueProblems(setup?.ruleset));
  problems.push(...aiMergeProblems(setup?.ai_merge));
  problems.push(...environmentProblems(setup?.environments));
  for (const s of setup?.template_schedules ?? [])
    if (!s?.file || !s?.why) problems.push("template_schedules は file と why を書く");
  return problems;
}

/** ひな形の持ち主(@付き) */
export const templateOwner = (setup) => `@${setup.template_repository.split("/")[0]}`;

/** このリポジトリの役割(ひな形の名前と同じなら template) */
export const roleOf = (setup, fullName) =>
  String(fullName).toLowerCase() === setup.template_repository.toLowerCase()
    ? "template"
    : "product";

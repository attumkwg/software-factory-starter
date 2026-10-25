// 認証の準備(docs/compliance/)の読み方と確かめ方。CLI は run.mjs(pnpm compliance)。
// 管理策の一覧(controls.yaml)・規程(policies/*.md の頭の YAML)・点検の台帳(controls・evidence 欄)が、互いに指し合っているかを見る。
// 設計: docs/designs/0019-evidence-soa-and-cost.md の 2.・6.
import { posix } from "node:path";
import { parse } from "yaml";

export const DIR = "docs/compliance";
export const CONTROLS_FILE = `${DIR}/controls.yaml`;
export const SOA_FILE = `${DIR}/soa.md`;
export const POLICIES_DIR = `${DIR}/policies`;
/** 附属書 A(ISO/IEC 27001:2022)の管理策の数(5 組織 37・6 人 8・7 物理 14・8 技術 34) */
export const CONTROL_COUNT = { 5: 37, 6: 8, 7: 14, 8: 34 };
/** 規程のひな形で、人が埋める所の印(残っている間は「まだ自社の物になっていない」) */
export const PLACEHOLDER = /【要記入[^】]*】/g;

const isDateText = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const dateText = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);

export const loadControls = (text) => parse(text);

/** Markdown の頭の YAML(--- で挟む)を読む。無ければ meta は null */
export function parseFrontmatter(text) {
  const m = String(text ?? "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: null, body: String(text ?? "") };
  return { meta: parse(m[1]) ?? {}, body: String(text).slice(m[0].length) };
}

/** 規程のファイル(policies/*.md。README は除く)を読む: [{ file, meta, body, text }] */
export const loadPolicies = (files) =>
  files
    .filter((f) => f.file.endsWith(".md") && !f.file.endsWith("/README.md") && f.text !== undefined)
    .map((f) => ({ file: f.file, text: f.text, ...parseFrontmatter(f.text) }));

/** 管理策1件の書き方(validateControls の中身) */
function checkControl(c, exists) {
  const name = `管理策 ${c?.id ?? "(番号なし)"}`;
  const problems = [];
  if (!/^A\.[5-8]\.\d{1,2}$/.test(String(c?.id))) problems.push(`${name} の番号の形が違う`);
  if (!c?.name) problems.push(`${name} に name が無い`);
  if (typeof c?.applies !== "boolean") problems.push(`${name} の applies は true か false`);
  if (!c?.why) problems.push(`${name} に why(適用・除外の理由)が無い`);
  if (c?.applies === true && !c?.how) problems.push(`${name} は適用なので how(実施)が要る`);
  const missing = (c?.refs ?? []).filter((ref) => !exists(ref));
  return [...problems, ...missing.map((ref) => `${name} の根拠 ${ref} が無い(リンク切れ)`)];
}

/** 管理策の一覧の書き方(番号・名前・適用・理由・実施・根拠のファイルの実在・主題ごとの件数) */
export function validateControls(catalog, exists) {
  const list = catalog?.controls ?? [];
  const problems = list.flatMap((c) => checkControl(c, exists));
  const seen = new Set();
  for (const c of list) {
    if (seen.has(c?.id)) problems.push(`管理策 ${c?.id} が2回ある`);
    seen.add(c?.id);
  }
  for (const [theme, count] of Object.entries(CONTROL_COUNT)) {
    const n = list.filter((c) => String(c?.id).startsWith(`A.${theme}.`)).length;
    if (n !== count) problems.push(`A.${theme} の管理策は ${count}件のはず(いま ${n}件)`);
  }
  return problems;
}

function checkDates(meta, name) {
  const problems = ["established", "last_reviewed", "next_review"]
    .filter((key) => {
      const v = dateText(meta[key]);
      return v !== null && v !== undefined && !isDateText(v);
    })
    .map((key) => `${name} の ${key} は YYYY-MM-DD か null`);
  if (meta.established && !meta.next_review)
    problems.push(`${name} は制定したので next_review(次の見直しの日)が要る`);
  return problems;
}

/** 規程1つの頭の YAML(validatePolicies の中身) */
function checkPolicy(p, controlIds) {
  const name = `規程 ${p.file}`;
  if (!p.meta) return [`${name} に頭の YAML(--- で挟む)が無い`];
  const problems = ["title", "version", "owner"]
    .filter((key) => !p.meta[key])
    .map((key) => `${name} に ${key} が無い`);
  const controls = Array.isArray(p.meta.controls) ? p.meta.controls : [];
  if (controls.length === 0) problems.push(`${name} の controls(当たる管理策)は1件以上の一覧`);
  for (const c of controls.filter((c) => !controlIds.has(c)))
    problems.push(`${name} の controls「${c}」が管理策の一覧に無い`);
  return [...problems, ...checkDates(p.meta, name)];
}

/** 規程の頭の YAML(title・version・owner・controls・日付) */
export const validatePolicies = (policies, controlIds) =>
  policies.flatMap((p) => checkPolicy(p, controlIds));

/** 点検の台帳の controls・evidence が、管理策の一覧と証跡の名前にあるか */
export function validateLedgerRefs(ledger, controlIds, evidenceNames, catalog) {
  const problems = [];
  const unknownControls = (xs) => (xs ?? []).filter((c) => !controlIds.has(c));
  const unknownEvidence = (xs) => (xs ?? []).filter((e) => !evidenceNames.includes(e));
  for (const item of ledger?.items ?? []) {
    for (const c of unknownControls(item.controls))
      problems.push(`点検の項目 ${item.id} の controls「${c}」が管理策の一覧に無い`);
    for (const e of unknownEvidence(item.evidence))
      problems.push(`点検の項目 ${item.id} の evidence「${e}」が証跡の集め先に無い`);
  }
  for (const c of catalog?.controls ?? [])
    for (const e of unknownEvidence(c.evidence))
      problems.push(`管理策 ${c.id} の evidence「${e}」が証跡の集め先に無い`);
  return problems;
}

/** Markdown の相対リンク(外の URL・ページの中の # は見ない)が、実在するファイルを指しているか */
export function checkLinks(files, exists) {
  const problems = [];
  for (const { file, text } of files) {
    for (const m of String(text ?? "").matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1].split("#")[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      const path = posix.normalize(posix.join(posix.dirname(file), decodeURI(target)));
      if (!exists(path)) problems.push(`${file} のリンク ${m[1]} の先が無い(リンク切れ)`);
    }
  }
  return problems;
}

/** 見直しの日が来た・過ぎた規程(点検の policies-review) */
export const reviewDuePolicies = (policies, today) =>
  policies.filter((p) => p.meta?.next_review && dateText(p.meta.next_review) <= today);

/** まだ自社の物になっていない規程(制定日が無い・【要記入】が残っている。点検の policies-adopted) */
export const notAdoptedPolicies = (policies) =>
  policies.filter((p) => !p.meta?.established || (p.text ?? "").match(PLACEHOLDER));

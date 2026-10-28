// ペルソナの立場の地図(docs/product/personas.md)と、合議の記録(docs/product/councils/*.md)の確かめ(中身だけ)。
// 読み書きは kpi.mjs。決まりは docs/guides/kpi.md・仕様 0082・スキル /persona・/council。
import { allKpis } from "./kpi-lib.mjs";

export const STANCES = ["使う人", "買う人", "決める人", "止める人", "周りの人", "失う人", "運営"];
export const POWERS = ["拒否権", "予算", "影響", "なし"];
export const VOTES = ["賛成", "条件つき", "反対", "拒否"];
const PERSONA_EVIDENCE = ["記録", "公開の事例", "推測"];
const COUNCIL_EVIDENCE = ["記録", "事例", "推測"];

const field = (lines, name) => {
  const head = `- ${name}:`;
  return lines
    .find((l) => l.startsWith(head))
    ?.slice(head.length)
    .trim();
};

// 見出し「## P-n …」ごとに行をまとめる
function personaBlocks(md) {
  const out = [];
  let cur = null;
  for (const line of String(md ?? "").split("\n")) {
    if (line.startsWith("## P-")) {
      const id = line.slice(3).split(" ")[0];
      cur = { id, title: line.slice(3 + id.length).trim(), lines: [] };
      out.push(cur);
    } else if (line.startsWith("## ")) cur = null;
    else if (cur) cur.lines.push(line.trim());
  }
  return out;
}

/** personas.md を1人ずつに分ける。{ id, title, stance, power, evidence, segment, ended } */
export const parsePersonas = (md) =>
  personaBlocks(md).map(({ lines, ...p }) => ({
    ...p,
    stance: field(lines, "立場"),
    power: field(lines, "決める力"),
    evidence: field(lines, "根拠"),
    segment: (field(lines, "客層") ?? "").replace(/^<.*>$/, ""),
    ended: (field(lines, "状態") ?? "").startsWith("やめた"),
  }));

// 1人の書き方の誤り
function cardProblems(p) {
  const out = [];
  if (!STANCES.includes(p.stance)) out.push(`「- 立場:」は ${STANCES.join(" / ")} のどれか`);
  if (!POWERS.includes(p.power)) out.push(`「- 決める力:」は ${POWERS.join(" / ")} のどれか`);
  if (!PERSONA_EVIDENCE.some((e) => (p.evidence ?? "").startsWith(e)))
    out.push("「- 根拠:」は 記録 / 公開の事例 / 推測 のどれかで始める");
  return out.map((m) => `${p.id}: ${m}`);
}

// 客層ごとの立場の集まり(客層が1つなら全員で1つ)
function stancesBySegment(personas) {
  const segments = new Map();
  for (const p of personas.filter((x) => !x.ended)) {
    const key = p.segment || "";
    if (!segments.has(key)) segments.set(key, new Set());
    segments.get(key).add(p.stance);
  }
  return segments;
}

/** 立場の地図の誤り(1人ずつの書き方と、客層ごとに7つの立場がそろっているか) */
export function personaProblems(personas) {
  const problems = personas.flatMap(cardProblems);
  for (const [segment, stances] of stancesBySegment(personas)) {
    const missing = STANCES.filter((s) => !stances.has(s));
    if (missing.length === 0) continue;
    const where = segment ? `客層 ${segment} の` : "";
    problems.push(`立場の地図が埋まっていない(${where}足りない立場: ${missing.join("・")})`);
  }
  return problems;
}

const SECTIONS = [
  "## 1. 1人ずつの評価",
  "## 2. 反論役",
  "## 3. 議論の回",
  "## 4. 拒否と、その扱い",
  "## 5. 結論の案",
  "## 6. 次に確かめる問い",
  "## 7. 人の判断",
  "## 8. 星の採点",
];

/** 星の軸(計画の採点。仕様 0083)。価値と確からしさは表から機械で出し、残りは議長が根拠つきで付ける */
export const STAR_AXES = ["価値", "確からしさ", "守り", "ROI の見込み", "実現性"];

// 見出しごとの行(次の ## まで)
function sectionsOf(md) {
  const map = new Map();
  let cur = null;
  for (const line of String(md ?? "").split("\n")) {
    if (line.startsWith("## ")) {
      cur = SECTIONS.find((s) => line.startsWith(s)) ?? null;
      if (cur) map.set(cur, []);
    } else if (cur) map.get(cur).push(line);
  }
  return map;
}

const cellsOf = (line) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

// 1の表の1行の誤り
function rowProblems([id, , vote, , , evidence], stanceOf) {
  const out = [];
  if (!VOTES.includes(vote)) out.push(`${id}: 賛否は ${VOTES.join(" / ")} のどれか`);
  if (!COUNCIL_EVIDENCE.some((e) => (evidence ?? "").startsWith(e)))
    out.push(`${id}: 根拠は 記録 / 事例 / 推測 で始める`);
  if (!stanceOf.has(id)) out.push(`${id} が personas.md に無い`);
  return out;
}

// 1の表(全員の賛否)の誤り
function tableProblems(rows, stanceOf, vetoText) {
  const problems = rows.flatMap((r) => rowProblems(r, stanceOf));
  const stances = new Set(rows.map(([id]) => stanceOf.get(id)).filter(Boolean));
  const missing = STANCES.filter((s) => !stances.has(s));
  if (missing.length > 0) problems.push(`出席に足りない立場: ${missing.join("・")}`);
  for (const [id, , vote] of rows)
    if (vote === "拒否" && !vetoText.includes(id))
      problems.push(`拒否した ${id} の扱いが「4. 拒否と、その扱い」に無い`);
  return problems;
}

// 6(問い)と7(人の判断)の誤り
function closingProblems(sections) {
  const out = [];
  if (!sections.get(SECTIONS[5]).some((l) => l.trim().startsWith("- ")))
    out.push("「6. 次に確かめる問い」が1つも無い");
  const decision = sections
    .get(SECTIONS[6])
    .find((l) => l.startsWith("- 判断:"))
    ?.slice(6)
    .trim();
  if (!decision || !(decision === "未定" || decision.startsWith("@")))
    out.push("「7. 人の判断」は「- 判断: 未定」か「- 判断: @名前 YYYY-MM-DD …」");
  return out;
}

/** 合議の記録の誤り。stanceOf は P-n → 立場 */
export function councilProblems(md, stanceOf) {
  const sections = sectionsOf(md);
  const absent = SECTIONS.filter((s) => !sections.has(s)).map((s) => `「${s}」の見出しが無い`);
  if (absent.length > 0) return absent;
  const rows = sections
    .get(SECTIONS[0])
    .filter((l) => l.trim().startsWith("| P-"))
    .map(cellsOf);
  return [
    ...tableProblems(rows, stanceOf, sections.get(SECTIONS[3]).join("\n")),
    ...closingProblems(sections),
    ...starProblems(md),
  ];
}

/** 1の表の行(ペルソナ・立場・賛否・根拠)。星の機械の分に使う */
export function councilRows(md) {
  return (sectionsOf(md).get(SECTIONS[0]) ?? [])
    .filter((l) => l.trim().startsWith("| P-"))
    .map(cellsOf)
    .map(([id, stance, vote, , , evidence]) => ({ id, stance, vote, evidence: evidence ?? "" }));
}

/** 8の表の星(軸 → ★)。読めない行は飛ばす */
export function councilStars(md) {
  const stars = new Map();
  for (const line of sectionsOf(md).get(SECTIONS[7]) ?? []) {
    if (!line.trim().startsWith("|")) continue;
    const [axis, star] = cellsOf(line);
    const n = Number(String(star).replace("★", ""));
    if (STAR_AXES.includes(axis) && Number.isFinite(n)) stars.set(axis, n);
  }
  return stars;
}

// 8(星)の誤り: 5つの軸が 1〜5 で付いているか
function starProblems(md) {
  const stars = councilStars(md);
  return STAR_AXES.filter((a) => !(stars.get(a) >= 1 && stars.get(a) <= 5)).map(
    (a) => `「8. 星の採点」に ${a} の ★(1〜5)が無い`,
  );
}

/** 合議から来ていない指標(council が無い・記録が無い)を知らせる文の並び。files は記録のパスの集まり */
export function councilLinkNotes(doc, files) {
  const notes = [];
  for (const k of allKpis(doc).filter((x) => x.status !== "やめた")) {
    if (!k.council) notes.push(`${k.id}: どの合議から来たか(council)がまだ無い(/council)`);
    else if (!files.has(k.council)) notes.push(`${k.id}: council の記録 ${k.council} が無い`);
  }
  return notes;
}

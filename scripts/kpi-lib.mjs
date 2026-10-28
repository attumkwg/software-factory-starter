// KPI の木(docs/product/kpi.yaml)とペルソナ(docs/product/personas.md)の確かめと、線との比べ(中身だけ)。
// 読み書きは kpi.mjs。決まりは docs/guides/kpi.md・仕様 0081。

export const HOWS = ["usage", "survey", "manual"];
export const KPI_STATES = ["仮説", "確か", "やめた"];
const DIRECTIONS = ["below", "above"];

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ""));
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const live = (k) => k?.status !== "やめた";

/** personas.md の見出し(## P-1 …)から、ペルソナの番号の集まり */
export const personaIdsOf = (md) =>
  new Set([...String(md ?? "").matchAll(/^##\s+(P-\d+)\b/gm)].map((m) => m[1]));

/** 機能フラグの定義(packages/shared/src/feature-flags.ts)から、名前の集まり(注の中の見本は数えない) */
export const featureNamesOf = (ts) =>
  new Set(
    String(ts ?? "")
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/)/.test(l))
      .flatMap((l) => [...l.matchAll(/\bname:\s*"([^"]+)"/g)].map((m) => m[1])),
  );

/** 文の中の P-n・K-n(K-Gn)を拾う */
export const personaRefs = (s) => [...String(s ?? "").matchAll(/\bP-\d+\b/g)].map((m) => m[0]);
export const kpiRefs = (s) => [...String(s ?? "").matchAll(/\bK-G?\d+\b/g)].map((m) => m[0]);

// 前の空白を飛ばし、空白か # の前までの1語
const firstWord = (s) => {
  const t = s.trim();
  const end = [...t].findIndex((c) => c === " " || c === "\t" || c === "#");
  return end < 0 ? t : t.slice(0, end);
};

/** kpi.yaml の文から、指標の番号の集まり(YAML の部品を読まずに。依存を入れずに流す PR の本文の検査からも呼ばれる) */
export const kpiIdsOf = (yamlText) =>
  new Set(
    String(yamlText ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("id:") || l.startsWith("- id:"))
      .map((l) => firstWord(l.slice(l.indexOf("id:") + 3))),
  );

/** 木の全部の指標(種類つき) */
export const allKpis = (doc) => [
  ...(doc?.north_star ? [{ ...doc.north_star, kind: "north_star" }] : []),
  ...(doc?.inputs ?? []).map((k) => ({ ...k, kind: "input" })),
  ...(doc?.guardrails ?? []).map((k) => ({ ...k, kind: "guardrail" })),
  ...(doc?.watch ?? []).map((k) => ({ ...k, kind: "watch" })),
];

// 番号の形(正規表現を使わずに見る): 北極星 K-0・入力 K-1…・守り K-G1…
const isCount = (s) =>
  s.length > 0 && s.length < 5 && s[0] !== "0" && [...s].every((c) => c >= "0" && c <= "9");
const ID_FORM = {
  north_star: (id) => id === "K-0",
  input: (id) => id.startsWith("K-") && isCount(id.slice(2)),
  guardrail: (id) => id.startsWith("K-G") && isCount(id.slice(3)),
  // 見るだけの数は、決める前の番号のまま(番号は変えない)
  watch: (id) =>
    id.startsWith("K-G") ? isCount(id.slice(3)) : id.startsWith("K-") && isCount(id.slice(2)),
};
const KIND_NAME = { north_star: "北極星", input: "入力", guardrail: "守り", watch: "見るだけ" };
// 人が決めて追う数の上限(極端に絞る。仕様 0082)。残りは watch(見るだけの数)へ
export const LIMITS = { inputs: [1, 2], guardrails: [1, 2] };

function checkMeasure(k, at, features, problems, warnings) {
  const m = k.measure ?? {};
  if (!HOWS.includes(m.how)) {
    problems.push(`${at}: measure.how は ${HOWS.join(" / ")} のどれか`);
    return;
  }
  if (m.how === "usage") {
    if (!m.feature) problems.push(`${at}: usage は measure.feature(機能フラグの名前)が要る`);
    else if (!features.has(m.feature))
      warnings.push(`${at}: 機能フラグ「${m.feature}」がまだ無い(作るときに feature-flags.ts へ)`);
  } else if (!m.source) {
    problems.push(`${at}: ${m.how} は measure.source(何で数えるか)が要る`);
  }
}

// 守りの線(limit)の誤り。無ければ null
function limitProblem(k) {
  const l = k.limit;
  if (!l || !DIRECTIONS.includes(l.direction)) return "守りは limit.direction(below / above)が要る";
  if (k.money && l.value !== undefined)
    return "金額の指標は線の金額をリポジトリに書かない(非公開の置き場へ)";
  if (!k.money && !isNum(l.value)) return "limit.value は数で";
  return null;
}

// 目標(target)の誤りの並び
function targetProblems(k) {
  const t = k.target;
  const out = [];
  if (k.money && t.value !== undefined)
    out.push("金額の指標は目標の金額をリポジトリに書かない(非公開の置き場へ)");
  if (!k.money && !isNum(t.value)) out.push("target.value は数で");
  if (!isDate(t.by)) out.push("target.by は YYYY-MM-DD で");
  if (t.direction !== undefined && !DIRECTIONS.includes(t.direction))
    out.push("target.direction は above(既定。上回れば届いた)/ below(下回れば届いた)");
  return out;
}

function checkLine(k, at, problems, warnings) {
  if (k.kind === "watch") return; // 見るだけ。目標も線も持たない
  if (k.kind === "guardrail") {
    const p = limitProblem(k);
    if (p) problems.push(`${at}: ${p}`);
  } else if (!k.target) {
    if (live(k)) warnings.push(`${at}: 目標(target)がまだ無い`);
  } else {
    problems.push(...targetProblems(k).map((p) => `${at}: ${p}`));
  }
}

// 木の形(北極星1・入力 1〜2・守り 1〜2。残りは見るだけ)の誤りの並び
function shapeProblems(doc) {
  const out = [];
  if (!doc?.north_star) out.push("north_star(北極星の指標)が無い");
  for (const [key, name] of [
    ["inputs", "入力の指標(inputs)"],
    ["guardrails", "守りの指標(guardrails。「安全に」の部分)"],
  ]) {
    const n = (doc?.[key] ?? []).filter(live).length;
    const [min, max] = LIMITS[key];
    if (n < min || n > max)
      out.push(`${name}は ${min}〜${max} 個(いま ${n} 個)。残りは watch(見るだけの数)へ`);
  }
  return out;
}

// 1つの指標の番号・名前・状態・ペルソナの誤りの並び
function itemProblems(k, seen, personas) {
  const out = [];
  if (!ID_FORM[k.kind](String(k.id ?? "")))
    out.push("番号の形が違う(北極星 K-0・入力 K-1…・守り K-G1…)");
  if (seen.has(k.id)) out.push("番号が重なっている");
  if (!k.name) out.push("name が無い");
  if (!KPI_STATES.includes(k.status)) out.push(`status は ${KPI_STATES.join(" / ")} のどれか`);
  const needsPersona = k.kind === "north_star" || k.kind === "input";
  if ((needsPersona || k.persona !== undefined) && !personas.has(k.persona))
    out.push(`persona「${k.persona}」が personas.md に無い`);
  return out;
}

/** 木の形と1つずつの指標を確かめる。problems は CI を落とす物、warnings は出すだけ */
export function checkKpi(doc, { personas, features }) {
  const problems = shapeProblems(doc);
  const warnings = [];
  const seen = new Set();
  for (const k of allKpis(doc)) {
    const at = `${KIND_NAME[k.kind]} ${k.id ?? "(番号なし)"}`;
    problems.push(...itemProblems(k, seen, personas).map((p) => `${at}: ${p}`));
    seen.add(k.id);
    checkMeasure(k, at, features, problems, warnings);
    checkLine(k, at, problems, warnings);
  }
  checkRecords(doc, seen, problems);
  return { problems, warnings };
}

// 記録の1行の誤りの並び(金額の指標は reached だけ)
function recordProblems(r, ids, money) {
  const out = [];
  if (!isDate(r.date)) out.push("date は YYYY-MM-DD で");
  if (!ids.has(r.kpi)) out.push(`kpi「${r.kpi}」が木に無い`);
  if (!money.has(r.kpi)) {
    if (!isNum(r.value)) out.push("value は数で");
    return out;
  }
  if (r.value !== undefined) out.push("金額の指標は value を書かない(reached だけ)");
  if (typeof r.reached !== "boolean") out.push("金額の指標は reached: true / false");
  return out;
}

function checkRecords(doc, ids, problems) {
  const money = new Set(
    allKpis(doc)
      .filter((k) => k.money)
      .map((k) => k.id),
  );
  for (const [i, r] of (doc?.records ?? []).entries()) {
    problems.push(...recordProblems(r, ids, money).map((p) => `records の ${i + 1}行目: ${p}`));
  }
}

/** 指標ごとの最新の値と、線との比べ(一覧に出す) */
export function kpiReport(doc, today) {
  const records = doc?.records ?? [];
  return allKpis(doc)
    .filter(live)
    .map((k) => {
      const last = records
        .filter((r) => r.kpi === k.id)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .at(-1);
      return {
        id: k.id,
        kind: k.kind,
        name: k.name,
        unit: k.unit,
        last,
        judge: judge(k, last, today),
      };
    });
}

// 値が線の内か(below = 少ないほど良い)。strict は守り(線ちょうどは超えた扱い)
const within = (value, line, direction, strict) => {
  if (direction === "below") return strict ? value < line : value <= line;
  return strict ? value > line : value >= line;
};

function judgeGuardrail(k, last) {
  if (!last) return "まだ測っていない";
  const ok = k.money ? last.reached : within(last.value, k.limit.value, k.limit.direction, true);
  return ok ? "守れている" : "超えた";
}

function judge(k, last, today) {
  if (k.kind === "watch") return "見るだけ";
  if (k.kind === "guardrail") return judgeGuardrail(k, last);
  if (!k.target) return "目標なし";
  const late = k.target.by < today;
  if (!last) return late ? "期限を過ぎた(まだ測っていない)" : "まだ測っていない";
  const reached = k.money
    ? last.reached
    : within(last.value, k.target.value, k.target.direction, false);
  if (reached) return "届いた";
  return late ? "期限を過ぎた" : "まだ";
}

/** 賭けが指すペルソナと KPI(psf から必須。仕様 0081)。problems の文の並び */
export const MUST_LINK = ["psf", "rollout", "adopted"];
export function betLinkProblems(bet, { personas, kpis }) {
  const problems = [];
  const ps = personaRefs(bet.persona);
  const ks = kpiRefs(bet.kpi);
  if (MUST_LINK.includes(bet.stage)) {
    if (ps.length === 0) problems.push(`段階 ${bet.stage} は「- ペルソナ: P-n」が要る`);
    if (ks.length === 0) problems.push(`段階 ${bet.stage} は「- 動かす KPI: K-n」が要る`);
  }
  for (const p of ps) if (!personas.has(p)) problems.push(`ペルソナ ${p} が personas.md に無い`);
  for (const k of ks) if (!kpis.has(k)) problems.push(`KPI ${k} が kpi.yaml に無い`);
  return problems;
}

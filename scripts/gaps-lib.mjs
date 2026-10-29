// 穴の一覧(docs/scenarios/gaps.md)を読んで確かめる中身。入口は gaps.mjs、テストは gaps.test.mjs。
// 決まりは docs/designs/0078-gaps-watch.md。Semgrep の regex_dos に当たらないよう、正規表現を使わずに読む。

/** 足す順番の段(gaps.md の「🎯 使える、の条件と足す順番」が正) */
export const STAGES = ["今すぐ", "使える前に", "使えた後で"];
export const START = "<!-- gaps:summary:start -->";
export const END = "<!-- gaps:summary:end -->";
const STAGE_HEADING = "## 🎯";
const LEFT_MARKS = ["🔴", "🟡", "🟢"];
const FORM_HINT = "✅ 済み / ✅ ほぼ済み / 🔧 #番号 / 🔴🟡🟢 / → G-xx に束ねた / ⛔ やらない";

const isDigit = (c) => c !== undefined && c >= "0" && c <= "9";
const isAsciiWord = (c) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || isDigit(c);
const digitsFrom = (s, i) => {
  let j = i;
  while (isDigit(s[j])) j += 1;
  return s.slice(i, j);
};
const idOf = (n) => `G-${String(n).padStart(2, "0")}`;

/** 「G-06」「G-122」の形か */
export const isGapId = (cell) => {
  if (!cell.startsWith("G-")) return false;
  const num = digitsFrom(cell, 2);
  return num.length >= 2 && num.length <= 3 && num.length === cell.length - 2;
};

/** 文の中の穴の番号を、位置つきで返す([{ id, start, end }]) */
export const gapRefs = (text) => {
  const out = [];
  let at = text.indexOf("G-");
  while (at >= 0) {
    const before = at === 0 ? "" : text[at - 1];
    const num = digitsFrom(text, at + 2);
    if (num.length >= 2 && !(before && isAsciiWord(before)))
      out.push({ id: idOf(Number(num)), start: at, end: at + 2 + num.length });
    at = text.indexOf("G-", at + 2);
  }
  return out;
};

// 番号どうしをつなぐ文字(「G-01・G-02」「G-80〜G-84」)
const JOINS = ["・", "、", "〜", " と ", "と", ", "];

/** 続けて書いた番号をまとめる。「〜」は間の番号も入れる([{ ids, start, end }]) */
export const gapGroups = (text) => {
  const groups = [];
  for (const ref of gapRefs(text)) {
    const last = groups.at(-1);
    const between = last ? text.slice(last.end, ref.start) : undefined;
    if (!last || !JOINS.includes(between)) {
      groups.push({ ids: [ref.id], start: ref.start, end: ref.end });
      continue;
    }
    if (between === "〜") {
      const from = Number(last.ids.at(-1).slice(2));
      for (let n = from + 1; n < Number(ref.id.slice(2)); n += 1) last.ids.push(idOf(n));
    }
    last.ids.push(ref.id);
    last.end = ref.end;
  }
  return groups;
};

/** 表の1行(| … |)をセルに分ける。表でなければ undefined */
export const cellsOf = (raw) => {
  const line = raw.trim();
  if (!line.startsWith("|") || !line.endsWith("|") || line.length < 2) return undefined;
  return line
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
};

/** 「何が無いか」のセルの頭から、行の状態を読む。形が違えば undefined */
export const statusOf = (cell) => {
  if (cell.startsWith("→ ") && cell.includes("に束ねた")) return "束ねた";
  if (cell.startsWith("⛔ やらない")) return "やらない";
  if (cell.startsWith("✅ 済み")) return "済み";
  if (cell.startsWith("✅ ほぼ済み")) return "ほぼ済み";
  if (cell.startsWith("🔧")) return "作業中";
  if (LEFT_MARKS.some((m) => cell.startsWith(m))) return "残り";
  return undefined;
};

/** セルの中の PR の番号(「#139」)。無ければ undefined */
export const prOf = (cell) => {
  let at = cell.indexOf("#");
  while (at >= 0) {
    const num = digitsFrom(cell, at + 1);
    if (num.length > 0) return Number(num);
    at = cell.indexOf("#", at + 1);
  }
  return undefined;
};

/** セルの中の仕様の番号(「仕様 0024・0037」→ ["0024", "0037"]) */
export const specsOf = (cell) => {
  const out = [];
  let at = cell.indexOf("仕様 ");
  while (at >= 0) {
    let i = at + 3;
    let num = digitsFrom(cell, i);
    while (num.length === 4) {
      out.push(num);
      i += 4;
      if (cell[i] !== "・") break;
      i += 1;
      num = digitsFrom(cell, i);
    }
    at = cell.indexOf("仕様 ", at + 3);
  }
  return out;
};

/** gaps.md の穴の行(1列目が G-xx)を読む */
export const readRows = (text) => {
  const rows = [];
  let section = "";
  text.split("\n").forEach((line, index) => {
    if (line.startsWith("## ")) section = line.slice(3).trim();
    const cells = cellsOf(line);
    if (!cells || !isGapId(cells[0])) return;
    const cell = cells[1] ?? "";
    const status = statusOf(cell);
    rows.push({
      id: cells[0],
      line: index + 1,
      section,
      status,
      parent: status === "束ねた" ? gapRefs(cell)[0]?.id : undefined,
      pr: prOf(cell),
      specs: status === "済み" ? specsOf(cell) : [],
    });
  });
  return rows;
};

/** 「🎯」の節の、段の表の行を読む([{ stage, ids, line }])。番号は「(」より前だけを数える */
export const readStages = (text) => {
  const out = [];
  let inside = false;
  text.split("\n").forEach((line, index) => {
    if (line.startsWith("## ")) inside = line.startsWith(STAGE_HEADING);
    const cells = inside ? cellsOf(line) : undefined;
    if (!cells || !STAGES.includes(cells[0])) return;
    const cut = cells[1] ?? "";
    const head = cut.includes("(") ? cut.slice(0, cut.indexOf("(")) : cut;
    out.push({ stage: cells[0], ids: gapGroups(head).flatMap((g) => g.ids), line: index + 1 });
  });
  return out;
};

// 済みの行が指す仕様が、無い・下書きのまま
const specProblems = (r, at, specStates) =>
  r.specs.flatMap((spec) => {
    const state = specStates.get(spec);
    if (state === undefined) return [`${at} は済みだが、仕様 ${spec} が docs/specs に無い`];
    if (state.startsWith("下書き"))
      return [`${at} は済みだが、仕様 ${spec} の状態が「下書き」のまま(作り終えたなら「完了」に)`];
    return [];
  });

// 1行の形(印・🔧 の番号・束ねた先)
const formProblems = (r, at, byId) => {
  if (!r.status) return [`${at} の印の形が違う(頭は ${FORM_HINT})`];
  if (r.status === "作業中" && r.pr === undefined)
    return [`${at} は 🔧 なのに PR の番号(#数字)が無い`];
  if (r.status !== "束ねた") return [];
  const parent = byId.get(r.parent);
  const bad = !parent || parent.id === r.id || parent.status === "束ねた";
  return bad ? [`${at} の束ねた先(${r.parent ?? "なし"})が一覧に無いか、束ねた行を指している`] : [];
};

const rowProblems = (rows, specStates) => {
  const seen = new Set();
  const byId = new Map(rows.map((r) => [r.id, r]));
  return rows.flatMap((r) => {
    const at = `gaps.md:${r.line} ${r.id}`;
    const dup = seen.has(r.id) ? [`${at} の番号が重なっている`] : [];
    seen.add(r.id);
    return [...dup, ...formProblems(r, at, byId), ...specProblems(r, at, specStates)];
  });
};

// 段の表の1つの番号
const stageIdProblems = (id, s, byId, stageOf) => {
  const row = byId.get(id);
  const out = [];
  if (!row) out.push(`gaps.md:${s.line} 段の表の ${id} が穴の一覧に無い`);
  else if (row.status === "やらない")
    out.push(`gaps.md:${s.line} ${id} はやらないと決めた行。段の表から外す`);
  else if (row.status === "束ねた")
    out.push(`gaps.md:${s.line} ${id} は束ねた行。段の表には束ねた先(${row.parent})を書く`);
  if (stageOf.has(id)) out.push(`gaps.md:${s.line} ${id} が2つの段に入っている`);
  return out;
};

const stageProblems = (rows, stages) => {
  const problems = [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const stageOf = new Map();
  for (const s of stages)
    for (const id of s.ids) {
      problems.push(...stageIdProblems(id, s, byId, stageOf));
      stageOf.set(id, s.stage);
    }
  // やらないと決めた行と、その子は段に入れない
  const closed = (r) => r.status === "やらない" || byId.get(r.parent)?.status === "やらない";
  for (const r of rows) {
    const via = stageOf.get(r.status === "束ねた" ? r.parent : r.id);
    if (via) stageOf.set(r.id, via);
    else if (r.status && r.status !== "済み" && !closed(r))
      problems.push(`gaps.md:${r.line} ${r.id} は残っているのに、どの段にも入っていない`);
  }
  return { problems, stageOf };
};

/**
 * gaps.md を確かめる。specStates は仕様の番号 → 「> 状態:」の中身(Map)。
 * 返すのは { rows, stageOf, problems }
 */
export const checkGaps = (text, specStates) => {
  const rows = readRows(text);
  const stages = readStages(text);
  if (stages.length === 0)
    return { rows, stageOf: new Map(), problems: ["gaps.md に「🎯」の節の段の表が無い"] };
  const staged = stageProblems(rows, stages);
  return {
    rows,
    stageOf: staged.stageOf,
    problems: [...rowProblems(rows, specStates), ...staged.problems],
  };
};

const COUNTED = ["済み", "ほぼ済み", "作業中", "残り", "やらない"];
const countOf = (rows, byId) => {
  const c = { 全体: rows.length, 済み: 0, ほぼ済み: 0, 作業中: 0, 残り: 0, やらない: 0 };
  for (const r of rows) {
    const parentClosed = byId.get(r.parent)?.status === "やらない";
    const key = r.status === "束ねた" ? (parentClosed ? "やらない" : "残り") : r.status;
    if (COUNTED.includes(key)) c[key] += 1;
  }
  return c;
};

/** 数の要約: 全部と段ごと([{ name, 全体, 済み, ほぼ済み, 作業中, 残り, やらない }]) */
export const summarize = ({ rows, stageOf }) => {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return [
    { name: "全部", ...countOf(rows, byId) },
    ...STAGES.map((stage) => ({
      name: stage,
      ...countOf(
        rows.filter((r) => stageOf.get(r.id) === stage),
        byId,
      ),
    })),
  ];
};

/** gaps.md の頭に置く「今の数」の表(印の間に入る中身) */
export const renderSummary = (summary) =>
  [
    "| 今の数 | 全体 | 済み | ほぼ済み | 作業中 | 残り | やらない |",
    "|---|---|---|---|---|---|---|",
    ...summary.map(
      (s) =>
        `| ${s.name} | ${s.全体} | ${s.済み} | ${s.ほぼ済み} | ${s.作業中} | ${s.残り} | ${s.やらない} |`,
    ),
  ].join("\n");

/** 印の間の今の中身。印が無ければ undefined */
export const currentSummary = (text) => {
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start < 0 || end < start) return undefined;
  return text.slice(start + START.length, end).trim();
};

/** 印の間を作り直した gaps.md */
export const replaceSummary = (text, block) => {
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start < 0 || end < start) throw new Error(`gaps.md に ${START} と ${END} の印がありません`);
  return `${text.slice(0, start + START.length)}\n${block}\n${text.slice(end)}`;
};

// ── 済んだ穴を「まだ無い」と書いた所 ──

// 番号の後ろに続くと「まだ無い」と読める言葉(閉じかっこの後ろも見る)
const STALE_AFTER = ["が埋まるまで", "を入れるとき"];
const SKIP_AFTER = [")", "）", " "];

const afterGroup = (segment, end) => {
  let i = end;
  while (SKIP_AFTER.includes(segment[i])) i += 1;
  return segment.slice(i);
};

// 1つのかたまり(表のセルか、表でない行)の中で、済んだ番号の古い書き方を探す
// 「済」「足す前」を書いたかたまりは、済んだことを分かって書いている(見ない)
const segmentProblems = (segment, done) =>
  segment.includes("済") || segment.includes("足す前")
    ? []
    : gapGroups(segment).flatMap((g) => {
        const ids = g.ids.filter((id) => done.has(id));
        if (ids.length === 0) return [];
        const names = ids.join("・");
        const before = segment.slice(0, g.start).trimEnd();
        const after = afterGroup(segment, g.end);
        if (before.endsWith("穴") || before.endsWith("穴("))
          return [`「穴 ${names}」と書いているが、${names} は済み`];
        const word = STALE_AFTER.find((w) => after.startsWith(w));
        if (word) return [`「${names} ${word}」と書いているが、${names} は済み`];
        if (segment.includes("❌")) return [`❌ と一緒に ${names} を指しているが、${names} は済み`];
        return [];
      });

/**
 * 済んだ穴(done の Set)を「穴 G-xx」「G-xx が埋まるまでは」「G-xx を入れるときは」・❌ で指す所を探す。
 * 台本(scenario: true)では「足す前の判定」の行と、その下の字下げした行を見ない。返すのは [{ line, message }]
 */
export const staleRefs = (text, done, { scenario = false } = {}) => {
  const out = [];
  let skipIndent = -1;
  text.split("\n").forEach((line, index) => {
    const indent = line.length - line.trimStart().length;
    if (skipIndent >= 0 && line.trim() !== "" && indent > skipIndent) return;
    skipIndent = -1;
    if (scenario && line.trimStart().startsWith("- 足す前の判定")) {
      skipIndent = indent;
      return;
    }
    const segments = cellsOf(line) ?? [line];
    for (const segment of segments)
      for (const message of segmentProblems(segment, done)) out.push({ line: index + 1, message });
  });
  return out;
};

// 読む文書: docs(仕様・設計書・ADR と、穴の一覧そのものは除く)とルートの README.md
const SKIP_PREFIXES = ["docs/specs/", "docs/designs/", "docs/adr/"];
const SKIP_FILES = ["docs/scenarios/gaps.md"];

/** 古い書き方を探すファイルか */
export const shouldScan = (path) =>
  path === "README.md" ||
  (path.startsWith("docs/") &&
    (path.endsWith(".md") || path.endsWith(".yaml")) &&
    !SKIP_PREFIXES.some((p) => path.startsWith(p)) &&
    !SKIP_FILES.includes(path));

/** 台本のファイルか(「足す前の判定」を見ない) */
export const isScenario = (path) => path.startsWith("docs/scenarios/");

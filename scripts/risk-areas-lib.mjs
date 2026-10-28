// 危険度「高」の領域の表(docs/concepts/risk-areas.md)を読み、line.md の「高」の言葉・守る場所の一覧と突き合わせる。
// 読むのは check-guards.mjs(ずれたら落とす)と pr-merge-when-green.mjs(断るときに問いを返す)。ADR 0083

/** 表の行のセル(前後の | を外す) */
const cells = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

/** セルの中のバッククォートで囲んだ道 */
const pathsIn = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

/** 見出し(## の行)から次の見出しまでの、表の本文の行(見出しの行と --- の行は外す) */
function tableRows(markdown, heading) {
  const lines = String(markdown ?? "").split("\n");
  const start = lines.findIndex((l) => l.startsWith(`## ${heading}`));
  if (start < 0) return [];
  const rows = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    if (line.trim().startsWith("|")) rows.push(cells(line));
  }
  return rows.slice(2);
}

/** 「高」の領域の並び: { area(頭の言葉), name, guarded, code, question } */
export function parseRiskAreas(markdown) {
  return tableRows(markdown, "1.").map(([name, guarded, code, question]) => ({
    area: name.split("(")[0].trim(),
    name,
    guarded: pathsIn(guarded),
    code: pathsIn(code),
    question,
  }));
}

/** 「中」の場所の並び(道) */
export const parseMediumPlaces = (markdown) =>
  tableRows(markdown, "2.").flatMap(([place]) => pathsIn(place));

/** line.md の 5 の表の「高」の行の「例」の言葉 */
export function highWordsFromLine(lineMd) {
  const row = String(lineMd ?? "")
    .split("\n")
    .find((l) => l.startsWith("| 高 |"));
  return row
    ? cells(row)[1]
        .split("・")
        .map((w) => w.trim())
    : [];
}

/** "x/**" は x/ の下の全部、ほかは同じ名前だけ(フックと同じ当たり方) */
const matches = (file, pattern) =>
  pattern.endsWith("/**") ? file.startsWith(pattern.slice(0, -2)) : file === pattern;

/** line.md の「高」の言葉 ⇔ 表の領域の頭の言葉 */
function wordProblems(areas, highWords) {
  const heads = new Set(areas.map((a) => a.area));
  return [
    ...highWords
      .filter((w) => !heads.has(w))
      .map((w) => `line.md の「高」の「${w}」が risk-areas.md の 1 の表に無い`),
    ...[...heads]
      .filter((h) => !highWords.includes(h))
      .map((h) => `risk-areas.md の「${h}」が line.md の 5 の表の「高」に無い`),
  ];
}

/** 1つの領域: 守る場所は一覧に入っていて、あること・コードはあること・問いがあること */
function areaProblems(a, protectedPaths, exists) {
  const there = (p) => exists(p.replace(/\/\*\*$/, ""));
  return [
    ...a.guarded
      .filter((p) => !protectedPaths.includes(p))
      .map((p) => `${a.name} の守る場所 ${p} が protected-paths.json に無い`),
    ...a.guarded.filter((p) => !there(p)).map((p) => `${a.name} の守る場所 ${p} が無い`),
    ...a.code.filter((p) => !there(p)).map((p) => `${a.name} のコード ${p} が無い`),
    ...(a.question ? [] : [`${a.name} に聞く問いが無い`]),
  ];
}

/**
 * 表と守る場所のずれ(空ならそろっている)。
 * protectedPaths は protected-paths.json、apiDirs は apps/api/src の下の場所の名前、exists は道があるか
 */
export function riskAreaProblems({ areas, medium, highWords, protectedPaths, apiDirs, exists }) {
  if (areas.length === 0) return ["risk-areas.md の 1 の表が読めない"];
  // apps/api/src の下の場所は、「高」か「中」のどちらかに決めてある
  const placed = [...areas.flatMap((a) => [...a.guarded, ...a.code]), ...medium];
  const unplaced = apiDirs
    .map((dir) => `apps/api/src/${dir}/**`)
    .filter((p) => !placed.includes(p))
    .map((p) => `${p} が risk-areas.md の「高」にも「中」にも無い(どちらかに決める)`);
  return [
    ...wordProblems(areas, highWords),
    ...areas.flatMap((a) => areaProblems(a, protectedPaths, exists)),
    ...unplaced,
  ];
}

/** 変えたファイルが当たる「高」の領域(問いを返す)。同じ領域は1回だけ */
export const touchedAreas = (files, areas) =>
  areas.filter((a) => a.guarded.some((p) => files.some((f) => matches(f, p))));

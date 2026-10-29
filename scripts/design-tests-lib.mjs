// 設計書の「7. 要求との対応」の表が、受け入れ条件の1つずつにテストのファイルを名指しているかを確かめる(pnpm design-tests の中身)。
// 入口は design-tests.mjs、テストは design-tests.test.mjs、決まりは docs/designs/0097-design-test-paths.md。
// Semgrep の regex_dos に当たらないよう、正規表現を使わずに読む(decisions-lib.mjs と同じ)。

const DESIGNS = "docs/designs/";
const SPECS = "docs/specs/";
const STATES = ["下書き", "承認済み", "完了"];
// テストの欄で、テストを書かずに人が確かめる行の印(理由を書く)
export const MANUAL = "(手で確かめる:";

const isDoc = (dir) => (name) => {
  if (!name.startsWith(dir) || !name.endsWith(".md")) return false;
  const file = name.slice(dir.length);
  return !file.includes("/") && !file.startsWith("_") && file !== "README.md";
};

/** 変えたファイルの名前から、確かめる設計書だけを残す(ひな形・README・下のフォルダは見ない) */
export const designFiles = (names) => names.filter(isDoc(DESIGNS));

/** git の -z の出力(「\0」区切り)をファイルの名前に分ける */
export const splitZ = (out) => out.split("\0").filter(Boolean);

/** 表の1行をセルに分ける(頭と終わりの「|」は外す) */
function cells(line) {
  const inner = line.trim();
  const body = inner.slice(1, inner.endsWith("|") ? -1 : undefined);
  return body.split("|").map((cell) => cell.trim());
}

/** |---|:--| の行か */
function isSeparator(row) {
  return row.every((cell) => cell.length > 0 && [...cell].every((ch) => ch === "-" || ch === ":"));
}

/**
 * セルの中の「`」で囲んだ物のうち、テストのファイルのパスに見える物。
 * パス = 「/」を含み、空白が無く、最後の段(ファイル名)に `.test.` か `.spec.` がある物。
 * `audit-coverage`(テストの通り名)・`mail.int.test.ts`(ファイル名だけ)・`scripts/x.mjs`(テストでない)は数えない。
 */
export function testPaths(cell) {
  const parts = cell.split("`");
  const paths = [];
  for (let i = 1; i < parts.length; i += 2) {
    const text = (parts[i] ?? "").trim();
    if (text.includes(" ") || !text.includes("/")) continue;
    const name = text.slice(text.lastIndexOf("/") + 1);
    if (name.includes(".test.") || name.includes(".spec.")) paths.push(text);
  }
  return paths;
}

/** 「(手で確かめる: 理由)」の理由(印が無い・理由が空なら空) */
export function manualReason(cell) {
  const at = cell.indexOf(MANUAL);
  if (at === -1) return "";
  const rest = cell.slice(at + MANUAL.length);
  const end = rest.indexOf(")");
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

/** リポジトリの中を指さないパス(根からの「/」・上へ出る「..」) */
export const badPath = (path) => path.startsWith("/") || path.split("/").includes("..");

/** 「> 状態:」の頭の言葉(下書き・承認済み・完了)。行が無い・読めなければ空 */
export function stateWord(text) {
  for (const line of text.split("\n")) {
    if (!line.startsWith("> 状態:")) continue;
    const value = line.slice("> 状態:".length).trim();
    return STATES.find((word) => value.startsWith(word)) ?? "";
  }
  return "";
}

/** 「> 仕様:」の行の最初のリンクが指す仕様(docs/specs/….md)。無ければ空 */
export function specOf(design) {
  const line = design.split("\n").find((l) => l.startsWith("> 仕様:")) ?? "";
  const at = line.indexOf("](../specs/");
  if (at === -1) return "";
  const rest = line.slice(at + "](../specs/".length);
  const end = rest.indexOf(")");
  const name = end === -1 ? "" : rest.slice(0, end).split("#")[0];
  return name && !name.includes("/") ? `${SPECS}${name}` : "";
}

const isRequirementHeading = (line) => line.startsWith("## ") && line.includes("要求との対応");

/** 節(start の見出しの次から、次の「## 」の前まで)の最初の表の行。line は 1 から数えたファイルの行。表の後の文で終わる */
function sectionTable(lines, start) {
  const table = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.startsWith("## ")) break;
    if (line.trim().startsWith("|")) table.push({ line: i + 1, cells: cells(line) });
    else if (table.length > 0 && line.trim() !== "") break;
  }
  return table;
}

/** 「要求との対応」の節の行(見出しから次の「## 」の前まで。無ければ空) */
function requirementSection(text) {
  const lines = text.split("\n");
  const start = lines.findIndex(isRequirementHeading);
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
}

const lf = (text) => text.replaceAll("\r\n", "\n");

/**
 * 変えた設計書のうち、確かめる物か。before は元の版(新しい設計書なら null)。
 * 新しい設計書・「要求との対応」の節を変えた・状態の頭の言葉を変えた(「完了」にした)ときだけ見る。
 * 文の直しやリンクの付け替えで昔の設計書に触れただけなら見ない(昔の表はパスを書いていない物が多い)。
 */
export function needsCheck(before, after) {
  if (before === null) return true;
  return (
    requirementSection(lf(before)) !== requirementSection(lf(after)) ||
    stateWord(lf(before)) !== stateWord(lf(after))
  );
}

/**
 * 確かめる設計書を選ぶ。
 *   changes … 元から変えたファイル [{ file, before(元の中身。新しい物は null), after }](設計書と仕様)
 *   designs … 全部の設計書 [{ file, text }](この PR で「完了」にした仕様を指す設計書を探す)
 * 返す物: [{ file, isNew }](名前の順)
 */
export function selectDesigns(changes, designs) {
  const picked = new Map();
  for (const c of changes) {
    if (isDoc(DESIGNS)(c.file) && needsCheck(c.before, c.after)) {
      picked.set(c.file, c.before === null);
    }
  }
  const doneSpecs = changes
    .filter((c) => isDoc(SPECS)(c.file) && stateWord(lf(c.after)) === "完了")
    .filter((c) => c.before === null || stateWord(lf(c.before)) !== "完了")
    .map((c) => c.file);
  for (const d of designs) {
    if (!picked.has(d.file) && doneSpecs.includes(specOf(lf(d.text)))) picked.set(d.file, false);
  }
  return [...picked]
    .map(([file, isNew]) => ({ file, isNew }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * 比べる元が使えるか。
 *   resolved … 元のコミットが読めた / hasParent … HEAD に親がある / shallow … 浅い checkout か
 * 返す物: { ok: true } / { skip: 文 }(元が無い = 最初のコミット。見ずに通す。ci-scope.mjs と同じ向き)/ { error: 文 }
 */
export function baseStatus({ base, resolved, hasParent, shallow }) {
  if (resolved) return { ok: true };
  if (!hasParent && !shallow)
    return { skip: `比べる元が無い(${base}。最初のコミット)。見ずに通す` };
  return {
    error: `元(${base})と比べられない。手元なら git fetch origin、CI なら checkout の fetch-depth を確かめる(--base で元を渡せる)`,
  };
}

/**
 * テストのパスを探す場所: リポジトリの根と、各パッケージ(apps/*・packages/*)の中。
 * 昔の設計書は `test/integration/…` のように apps/api の中から書いている。dirs は { apps: [名前], packages: [名前] }
 */
export function pathRoots(dirs) {
  return ["", ...Object.entries(dirs).flatMap(([top, names]) => names.map((n) => `${top}/${n}/`))];
}

/**
 * 「要求との対応」の節の表を読む。
 * 返す物: { error } か { rows: [{ line, condition, paths, manual }] }(line は 1 から数えたファイルの行)
 */
export function requirementRows(text) {
  const lines = text.split("\n");
  const start = lines.findIndex(isRequirementHeading);
  if (start === -1) return { error: "「7. 要求との対応」の節が無い" };
  const [head, ...body] = sectionTable(lines, start);
  if (!head) return { error: "「要求との対応」の節に表が無い" };
  const testColumn = head.cells.indexOf("テスト");
  if (testColumn === -1) return { error: "「要求との対応」の表に「テスト」の列が無い" };
  const rows = body
    .filter((row) => !isSeparator(row.cells))
    .map((row) => {
      const cell = row.cells[testColumn] ?? "";
      return {
        line: row.line,
        condition: row.cells[0] ?? "",
        paths: testPaths(cell),
        manual: manualReason(cell),
      };
    });
  if (rows.length === 0) return { error: "「要求との対応」の表に行が無い" };
  return { rows };
}

const NO_PATH =
  "テストの欄にテストのファイルのパスが無い。確かめるテストのファイルを `apps/api/test/integration/….int.test.ts`・`apps/web/src/….test.tsx` の形で1つ以上書く(通り名や「画面の単体テスト」だけでは、作り忘れても分からない)。テストを書かずに人が確かめるなら「(手で確かめる: 理由)」";

/** 1行ぶんを確かめて、problems・waiting・manual に足す */
function checkRow(row, { done, exists }, out) {
  const where = `${row.line}行目「${row.condition}」`;
  if (row.paths.length === 0) {
    if (row.manual) out.manual.push(`${where}: 手で確かめる(${row.manual})`);
    else out.problems.push(`${where}: ${NO_PATH}`);
    return;
  }
  for (const path of row.paths) {
    if (badPath(path)) {
      out.problems.push(
        `${where}: \`${path}\` はリポジトリの中を指していない(「/」で始めない・「..」を使わない)`,
      );
    } else if (exists(path)) {
      // ある
    } else if (done) {
      out.problems.push(
        `${where}: \`${path}\` が無い(設計書か仕様の状態が「完了」。テストを足すか、名前が変わったなら表を直す)`,
      );
    } else {
      out.waiting.push(`${where}: \`${path}\` はまだ無い(作る PR で足す)`);
    }
  }
}

/**
 * 設計書を1つ確かめる。
 *   exists(path) … パスがリポジトリにあるか / specState … 指す仕様の状態の頭の言葉 / isNew … この PR で足した設計書か
 * 返す物: { problems: [文], waiting: [文], manual: [文] }
 *   problems … CI を落とす物(新しい設計書の状態が読めない / 節・表・列が無い / テストのパスも「手で確かめる」も無い行 /
 *              リポジトリの外を指すパス / 設計書か仕様が「完了」なのに無いファイル)
 *   waiting  … まだ無いファイル(「完了」でなければ落とさない。設計は実装より先に入るので)
 *   manual   … 「手で確かめる」と書いた行(落とさない。出して人の目に見せる)
 */
export function checkDesign(text, { exists, specState = "", isNew = false }) {
  const body = lf(text);
  const out = { problems: [], waiting: [], manual: [] };
  const state = stateWord(body);
  if (isNew && state === "") {
    out.problems.push(
      "「> 状態:」の行が無いか読めない(「> 状態: 下書き」のように、半角の「:」のあとに 下書き・承認済み・完了 のどれか)",
    );
  }
  const read = requirementRows(body);
  if (read.error) {
    out.problems.push(read.error);
    return out;
  }
  const done = state === "完了" || specState === "完了";
  for (const row of read.rows) checkRow(row, { done, exists }, out);
  return out;
}

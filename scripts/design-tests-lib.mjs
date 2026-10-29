// 設計書の「7. 要求との対応」の表が、受け入れ条件の1つずつにテストのファイルを名指しているかを確かめる(pnpm design-tests の中身)。
// 入口は design-tests.mjs、テストは design-tests.test.mjs、決まりは docs/designs/0093-design-test-paths.md。
// Semgrep の regex_dos に当たらないよう、正規表現を使わずに読む(decisions-lib.mjs と同じ)。

const DESIGNS = "docs/designs/";

/** 変えたファイルの名前から、確かめる設計書だけを残す(ひな形・README・下のフォルダは見ない) */
export function designFiles(names) {
  return names.filter((name) => {
    if (!name.startsWith(DESIGNS) || !name.endsWith(".md")) return false;
    const file = name.slice(DESIGNS.length);
    return !file.includes("/") && !file.startsWith("_") && file !== "README.md";
  });
}

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
 * セルの中の「`」で囲んだ物のうち、ファイルのパスに見える物。
 * パス = 「/」を含み、最後の段に「.」(拡張子)があり、空白が無い物。
 * `audit-coverage`(テストの通り名)や `mail.int.test.ts`(ファイル名だけ)はパスに数えない。
 */
export function testPaths(cell) {
  const parts = cell.split("`");
  const paths = [];
  for (let i = 1; i < parts.length; i += 2) {
    const text = (parts[i] ?? "").trim();
    if (text.includes(" ") || !text.includes("/")) continue;
    const last = text.slice(text.lastIndexOf("/") + 1);
    if (last.includes(".")) paths.push(text);
  }
  return paths;
}

/** 「> 状態:」の中身(無ければ空) */
export function designState(text) {
  for (const line of text.split("\n")) {
    if (line.startsWith("> 状態:")) return line.slice("> 状態:".length).trim();
  }
  return "";
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
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const start = lines.findIndex(isRequirementHeading);
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
}

/**
 * 変えた設計書のうち、確かめる物か。before は元の版(新しい設計書なら null)。
 * 新しい設計書・「要求との対応」の節を変えた・状態を変えた(「完了」にした)ときだけ見る。
 * 文の直しやリンクの付け替えで昔の設計書に触れただけなら見ない(昔の表はパスを書いていない物が多い)。
 */
export function needsCheck(before, after) {
  if (before === null) return true;
  return (
    requirementSection(before) !== requirementSection(after) ||
    designState(before) !== designState(after)
  );
}

/**
 * 「要求との対応」の節の表を読む。
 * 返す物: { error } か { rows: [{ line, condition, paths }] }(line は 1 から数えたファイルの行)
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
    .map((row) => ({
      line: row.line,
      condition: row.cells[0] ?? "",
      paths: testPaths(row.cells[testColumn] ?? ""),
    }));
  if (rows.length === 0) return { error: "「要求との対応」の表に行が無い" };
  return { rows };
}

/**
 * 設計書を1つ確かめる。exists(path) はパスがリポジトリにあるか。
 * 返す物: { problems: [文], waiting: [文] }
 *   problems … CI を落とす物(節・表・列が無い / テストのパスが無い行 / 「完了」なのに無いファイル)
 *   waiting  … まだ無いファイル(状態が「完了」でなければ落とさない。設計は実装より先に入るので)
 */
export function checkDesign(text, exists) {
  const read = requirementRows(text.replaceAll("\r\n", "\n"));
  if (read.error) return { problems: [read.error], waiting: [] };
  const done = designState(text).startsWith("完了");
  const problems = [];
  const waiting = [];
  for (const row of read.rows) {
    const where = `${row.line}行目「${row.condition}」`;
    if (row.paths.length === 0) {
      problems.push(
        `${where}: テストの欄にファイルのパスが無い。確かめるテストのファイルを \`apps/api/test/integration/….int.test.ts\`・\`apps/web/src/….test.tsx\` の形で1つ以上書く(通り名や「画面の単体テスト」だけでは、作り忘れても分からない)`,
      );
      continue;
    }
    for (const path of row.paths.filter((p) => !exists(p))) {
      if (done) {
        problems.push(
          `${where}: \`${path}\` が無い(状態は「完了」。テストを足すか、名前が変わったなら表を直す)`,
        );
      } else {
        waiting.push(`${where}: \`${path}\` はまだ無い(作る PR で足す)`);
      }
    }
  }
  return { problems, waiting };
}

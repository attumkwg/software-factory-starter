// ADR(docs/adr/NNNN-*.md)の番号を確かめる中身。入口は adr.mjs。
// Semgrep の regex_dos に当たらないよう、正規表現を使わずに読む。

const isDigits = (s) => s.length > 0 && [...s].every((c) => c >= "0" && c <= "9");

// 「0016-concurrent-index-migrations.md」から「0016」を取り出す。形が違えば undefined
export const numberOfFile = (file) => {
  const num = file.slice(0, 4);
  const rest = file.slice(4);
  const ok = isDigits(num) && rest.startsWith("-") && rest.length > "-.md".length;
  return ok && rest.endsWith(".md") ? num : undefined;
};

// files: [{ file, firstLine }]。`_` で始まるもの(_template.md)は見ない。問題の文の配列を返す
export const checkAdrs = (files) => {
  const problems = [];
  const seen = new Map();
  for (const { file, firstLine } of files) {
    if (file.startsWith("_") || !file.endsWith(".md")) continue;
    const num = numberOfFile(file);
    if (!num) {
      problems.push(`${file} ファイル名は NNNN-<英語の短い名前>.md(4桁の番号)`);
      continue;
    }
    const earlier = seen.get(num);
    if (earlier) {
      problems.push(
        `${file} 番号 ${num} が ${earlier} と重なっている(後から入った方を、いま一番大きい番号の次に振り直す)`,
      );
    } else {
      seen.set(num, file);
    }
    if (!firstLine.startsWith(`# ADR ${num}:`)) {
      problems.push(`${file} 1行目の見出しは「# ADR ${num}: …」(ファイル名と合わせる)`);
    }
  }
  return problems;
};

// 次に使う番号(いま一番大きい番号+1)
export const nextNumber = (files) => {
  const nums = files.map(({ file }) => numberOfFile(file)).filter((n) => n !== undefined);
  const max = nums.reduce((m, n) => Math.max(m, Number(n)), 0);
  return String(max + 1).padStart(4, "0");
};

// 仕様(docs/specs)・設計書(docs/designs)の番号。files: [{ file }]。同じフォルダの中で番号が重なれば落とす
// (仕様と設計書が同じ番号で対になるのは正しいので、フォルダをまたいでは見ない)。ADR と違い見出しの形は決めない
export const checkNumberedDocs = (dir, files) => {
  const problems = [];
  const seen = new Map();
  for (const { file } of files) {
    if (file.startsWith("_") || !file.endsWith(".md")) continue;
    const num = numberOfFile(file);
    if (!num) {
      problems.push(`${dir}/${file} ファイル名は NNNN-<英語の短い名前>.md(4桁の番号)`);
      continue;
    }
    const earlier = seen.get(num);
    if (earlier) {
      problems.push(
        `${dir}/${file} 番号 ${num} が ${dir}/${earlier} と重なっている(後から入った方を、仕様と設計書の両方で空いている次の番号に振り直す)`,
      );
    } else {
      seen.set(num, file);
    }
  }
  return problems;
};

// 仕様と設計書が次に使う番号(2つのフォルダ全部の中で一番大きい番号+1。対で同じ番号にするため)
export const nextDocNumber = (...fileLists) => nextNumber(fileLists.flat());

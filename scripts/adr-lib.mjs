// ADR(docs/adr/NNNN-*.md)の番号を確かめる中身。入口は adr.mjs。
// Semgrep の regex_dos に当たらないよう、正規表現を使わずに読む。
import { parse, parseDocument } from "yaml";

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

// ── 番号の範囲(docs/kit/numbering.yaml。G-116・仕様 0091)──
// キットは 0001〜kit_until だけを使い、キットから作ったリポジトリは own_from から振る。
// 範囲が重ならなければ、キットの新しい版を取り込んでも同じ番号はできない。own_from が無い(null)のはキットの中か、まだ取り込んでいないリポジトリ。
export const NUMBER_MAX = 9999;

const isWhole = (n) => Number.isInteger(n) && n >= 1 && n <= NUMBER_MAX;

// 設定そのものの問題。range: { kitUntil, ownFrom }(ownFrom は null か数)
export const checkRange = ({ kitUntil, ownFrom }) => {
  if (!isWhole(kitUntil)) return [`kit_until は 1〜${NUMBER_MAX} の整数(いま: ${kitUntil})`];
  if (ownFrom === null || ownFrom === undefined) return [];
  if (!isWhole(ownFrom)) return [`own_from は 1〜${NUMBER_MAX} の整数か null(いま: ${ownFrom})`];
  if (ownFrom <= kitUntil) {
    return [
      `own_from ${ownFrom} がキットの範囲(〜${kitUntil})と重なる(${kitUntil + 1} 以上にする)`,
    ];
  }
  return [];
};

// 番号が範囲の中にあるか。files: [{ file }]
//   own_from が無い(キットの中): kit_until を越えた番号は落とす(使う側の範囲に入る)
//   own_from がある(使う側): キットの範囲と自分の範囲の間の番号は落とす(どちらの物でもない)
export const checkNumbersInRange = (dir, files, { kitUntil, ownFrom }) => {
  const hasOwn = ownFrom !== null && ownFrom !== undefined;
  const problems = [];
  for (const { file } of files) {
    const num = numberOfFile(file);
    if (!num || Number(num) <= kitUntil) continue;
    if (!hasOwn) {
      problems.push(
        `${dir}/${file} 番号 ${num} がキットの範囲(〜${kitUntil})を越えた(キットの中なら範囲の中で振る。キットから作ったリポジトリなら pnpm adr --own-from で自分の範囲を決める)`,
      );
    } else if (Number(num) < ownFrom) {
      problems.push(
        `${dir}/${file} 番号 ${num} はキットの範囲(〜${kitUntil})でも自分の範囲(${ownFrom}〜)でもない(${ownFrom} 以上に振り直す)`,
      );
    }
  }
  return problems;
};

// 範囲の中で次に使う番号。own_from があれば、自分の範囲の一番大きい番号の次(無ければ own_from)
export const nextInRange = (files, { ownFrom } = {}) => {
  if (ownFrom === null || ownFrom === undefined) return nextNumber(files);
  const own = files.filter(({ file }) => Number(numberOfFile(file) ?? 0) >= ownFrom);
  return own.length > 0 ? nextNumber(own) : String(ownFrom).padStart(4, "0");
};

// docs/kit/numbering.yaml の文から範囲を読む
export const parseRange = (text) => {
  const data = parse(text) ?? {};
  return { kitUntil: data.kit_until, ownFrom: data.own_from ?? null };
};

// own_from だけを書き換えた文を返す(コメントと並びは崩さない)
export const withOwnFrom = (text, ownFrom) => {
  const doc = parseDocument(text);
  doc.set("own_from", ownFrom);
  return doc.toString({ lineWidth: 0 });
};

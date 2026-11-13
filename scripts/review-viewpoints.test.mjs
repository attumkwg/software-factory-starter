// 観点の台帳(docs/review-viewpoints.md)の観点が、全部どれかのレビューの人格の「持つ観点」に入っているか(仕様 0096)。
// 抜けた観点は、どの人格のレビュー役も見ない。node --test scripts/review-viewpoints.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const text = readFileSync("docs/review-viewpoints.md", "utf8");

/** 「(」より前だけ(「非機能(運用・性能)」→「非機能」) */
const nameOf = (cell) => cell.split("(")[0].trim();

/** 見出しの行が head で始まる表(同じ見出しの表が複数あれば全部)の、列 col のセルを全部 */
function column(head, col) {
  const lines = text.split("\n");
  const starts = lines.flatMap((l, i) => (l.startsWith(head) ? [i] : []));
  assert.ok(starts.length > 0, `表が無い: ${head}`);
  const cells = [];
  for (const start of starts) {
    for (const line of lines.slice(start + 2)) {
      if (!line.startsWith("|")) break;
      cells.push(line.split("|")[col + 1].trim());
    }
  }
  return cells;
}

const viewpoints = [...column("| # | 観点 |", 1), ...column("| 観点 | 何を見るか |", 0)].map(
  nameOf,
);
const covered = new Set(
  column("| 人格 |", 2)
    .flatMap((cell) => {
      // 「非機能(運用・性能・費用)」のかっこの中の「・」で割らない
      const out = [];
      let depth = 0;
      let cur = "";
      for (const ch of cell) {
        if (ch === "(") depth += 1;
        if (ch === ")") depth -= 1;
        if (ch === "・" && depth === 0) {
          out.push(cur);
          cur = "";
        } else cur += ch;
      }
      return [...out, cur];
    })
    .map(nameOf),
);

test("観点の台帳の観点は、全部どれかの人格が持つ", () => {
  assert.ok(viewpoints.length >= 15, `観点が少なすぎる(読み方が壊れた?): ${viewpoints.length}`);
  assert.deepEqual(
    viewpoints.filter((v) => !covered.has(v)),
    [],
    "どの人格も持たない観点がある(docs/review-viewpoints.md の「👥 レビューの人格」に足す)",
  );
});

test("画面の使いやすさ(UX)の観点が台帳にあり、🎨 が持つ(仕様 0099)", () => {
  for (const v of [
    "迷わなさ",
    "画面の状態",
    "見た目の強弱",
    "文言",
    "危ない操作と戻し方",
    "スマホでの操作",
  ])
    assert.ok(viewpoints.includes(v), `UX の観点が無い: ${v}`);
  const people = column("| 人格 |", 0);
  const i = people.findIndex((p) => p.startsWith("🎨"));
  assert.ok(i >= 0, "🎨 使いやすさを見る人が無い");
  assert.match(column("| 人格 |", 3)[i], /画面を変える/, "🎨 を呼ぶ PR は「画面を変える PR」");
});

test("人格は6人で、どの人格にも気持ちの1行と呼ぶ PR がある", () => {
  const people = column("| 人格 |", 0);
  assert.equal(people.length, 6);
  for (const [i, feeling] of column("| 人格 |", 1).entries())
    assert.ok(feeling.length > 10, `${people[i]} の気持ちが空`);
  for (const [i, when] of column("| 人格 |", 3).entries())
    assert.ok(when.length > 0, `${people[i]} の呼ぶ PR が空`);
});

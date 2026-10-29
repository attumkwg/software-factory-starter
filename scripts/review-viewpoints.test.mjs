// 観点の台帳(docs/review-viewpoints.md)の観点が、全部どれかのレビューの人格の「持つ観点」に入っているか(仕様 0096)。
// 抜けた観点は、どの人格のレビュー役も見ない。node --test scripts/review-viewpoints.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const text = readFileSync("docs/review-viewpoints.md", "utf8");

/** 「(」より前だけ(「非機能(運用・性能)」→「非機能」) */
const nameOf = (cell) => cell.split("(")[0].trim();

/** 見出しの行が head で始まる表の、列 col のセルを全部 */
function column(head, col) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith(head));
  assert.ok(start >= 0, `表が無い: ${head}`);
  const cells = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    cells.push(line.split("|")[col + 1].trim());
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

test("人格は5人で、どの人格にも気持ちの1行と呼ぶ PR がある", () => {
  const people = column("| 人格 |", 0);
  assert.equal(people.length, 5);
  for (const [i, feeling] of column("| 人格 |", 1).entries())
    assert.ok(feeling.length > 10, `${people[i]} の気持ちが空`);
  for (const [i, when] of column("| 人格 |", 3).entries())
    assert.ok(when.length > 0, `${people[i]} の呼ぶ PR が空`);
});

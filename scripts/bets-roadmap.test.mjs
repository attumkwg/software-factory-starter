// ロードマップの1枚(bets-roadmap.mjs)のテスト。node --test scripts/bets-roadmap.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderInternal, renderPublic } from "./bets-roadmap.mjs";

const row = (id, stage, extra = {}) => ({
  id,
  wills: extra.wills ?? 0,
  bet: {
    title: `賭け: ${id} ${extra.name ?? "名前"}`,
    stage,
    parent: extra.parent ?? "仮説1",
    lines: { rows: (extra.lines ?? []).map((cells) => ({ cells })) },
  },
});

const PSF_LINE = ["psf", "x", "3/5", "1/5", "2026-01-10", "2026-01-01"];
const ROWS = [
  row("B-0001", "psf", { name: "写真を並べる", lines: [PSF_LINE], wills: 1 }),
  row("B-0002", "idea", { name: "日報", parent: "仮説2" }),
  row("B-0003", "adopted", { name: "メール" }),
  row("B-0004", "dropped", { name: "地図" }),
];

test("社内の版: 段階ごとに分け、次に決める日・⚑・⏰ を出す", () => {
  const text = renderInternal(ROWS, "2026-02-01").join("\n");
  assert.ok(text.includes("| B-0001 | psf ⚑ | 写真を並べる | 仮説1 | 2026-01-10 ⏰ |"));
  assert.ok(text.includes("| B-0002 | 日報 | 仮説2 |"));
  assert.ok(text.includes("| B-0003 | メール |"));
  assert.ok(text.includes("| B-0004 | dropped | 地図 |"));
});

test("社外の版: 親・日付・ID・段階の名前・やめた物を出さない", () => {
  const text = renderPublic(ROWS, "2026-02-01").join("\n");
  assert.ok(text.includes("- 写真を並べる(試作で確かめています)"));
  assert.ok(text.includes("## これから試すこと\n\n- 日報"));
  for (const word of ["B-000", "仮説", "2026-01-10", "psf", "地図"]) {
    assert.ok(!text.includes(word), word);
  }
});

test("賭けが無い段は「なし」", () => {
  const text = renderInternal([], "2026-02-01").join("\n");
  assert.equal(text.split("- なし").length - 1, 4);
});

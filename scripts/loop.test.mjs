import assert from "node:assert/strict";
import { test } from "node:test";
import {
  councilHitRates,
  evidenceStars,
  forecastProblems,
  forecastResults,
  roiRange,
  staleNotes,
  unmeasuredBetNotes,
  valueStars,
} from "./loop-lib.mjs";

test("記録が4週より古い・無い追う指標を知らせ、見るだけの数は知らせない", () => {
  const report = [
    { id: "K-0", kind: "north_star", last: undefined },
    { id: "K-1", kind: "input", last: { date: "2026-09-01" } },
    { id: "K-2", kind: "input", last: { date: "2026-10-20" } },
    { id: "K-3", kind: "watch", last: undefined },
  ];
  const notes = staleNotes(report, "2026-10-28").join("\n");
  assert.match(notes, /K-0: まだ1件も/);
  assert.match(notes, /K-1: 最後の記録が 57 日前/);
  assert.doesNotMatch(notes, /K-2|K-3/);
});

test("rollout・adopted の賭けが動かす KPI に記録が無ければ知らせる", () => {
  const bets = [
    { id: "B-0001", stage: "adopted", kpis: ["K-2"] },
    { id: "B-0002", stage: "psf", kpis: ["K-1"] },
  ];
  assert.deepEqual(unmeasuredBetNotes(bets, new Set()), [
    "B-0001(adopted)が動かす K-2 に、まだ記録が無い",
  ]);
  assert.deepEqual(unmeasuredBetNotes(bets, new Set(["K-2"])), []);
});

test("合議の見込みを期限までの最後の実測と比べ、合議ごとの当たり率を出す", () => {
  const f = (kpi, low, high, by) => ({ date: "2026-10-01", kpi, council: "c.md", low, high, by });
  const doc = {
    forecasts: [
      f("K-1", 50, 80, "2026-10-20"),
      f("K-2", 60, 90, "2026-10-20"),
      f("K-1", 10, 20, "2026-12-31"),
      f("K-0", 1, 2, "2026-10-20"),
    ],
    records: [
      { date: "2026-10-15", kpi: "K-1", value: 70 },
      { date: "2026-10-25", kpi: "K-1", value: 10 },
      { date: "2026-10-18", kpi: "K-2", value: 40 },
    ],
  };
  const results = forecastResults(doc, "2026-10-28").map((r) => r.result);
  assert.deepEqual(results, ["当たり", "外れ", "まだ", "測っていない"]);
  const [rate] = councilHitRates(forecastResults(doc, "2026-10-28"));
  assert.equal(rate.hits, 1);
  assert.equal(rate.checked, 2);
  assert.equal(rate.redo, false);
  assert.ok(forecastProblems([{ ...f("K-9", 5, 1, "x") }], new Set(["K-1"])).length >= 3);
});

test("ROI の幅と回収の月数(悪い方は得た物が少なく原価が多い組み合わせ)", () => {
  const r = roiRange({
    cost: { low: 100, high: 200 },
    gainMonthly: { low: 10, high: 30 },
    months: 12,
  });
  assert.equal(r.roiLow, (10 * 12 - 200) / 200);
  assert.equal(r.roiHigh, (30 * 12 - 100) / 100);
  assert.equal(r.paybackLow, 100 / 30);
  assert.equal(r.paybackHigh, 200 / 10);
});

test("星: 推測だけの賛成は数えない・拒否があれば価値は ★2 まで・根拠が強いほど確からしさが上がる", () => {
  const row = (vote, evidence) => ({ vote, evidence });
  assert.equal(valueStars([row("賛成", "推測"), row("賛成", "推測")]), 1);
  assert.equal(valueStars([row("賛成", "記録"), row("賛成", "事例")]), 5);
  assert.equal(valueStars([row("賛成", "記録"), row("拒否", "推測")]), 2);
  assert.equal(evidenceStars([row("賛成", "推測"), row("賛成", "推測")]), 1);
  assert.equal(evidenceStars([row("賛成", "記録"), row("賛成", "記録")]), 5);
});

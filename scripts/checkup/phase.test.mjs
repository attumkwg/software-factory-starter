// 段階と日付の計算(phase.mjs)のテスト。node --test scripts/checkup/phase.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, daysBetween, phaseOf, reached, todayInTokyo } from "./phase.mjs";

const START = "2026-10-17";
const on = (days) => addDays(START, days);

test("段階の境目: 29日・30日・89日・90日・179日・180日・364日・365日・729日・730日", () => {
  const cases = [
    [0, "setup"],
    [29, "setup"],
    [30, "1m"],
    [89, "1m"],
    [90, "3m"],
    [179, "3m"],
    [180, "6m"],
    [364, "6m"],
    [365, "1y"],
    [729, "1y"],
    [730, "2y"],
    [2000, "2y"],
  ];
  for (const [days, phase] of cases)
    assert.equal(phaseOf(START, on(days)).phase.id, phase, `${days}日目`);
});

test("次の段階とその始まりの日", () => {
  const p = phaseOf(START, "2026-10-22");
  assert.equal(p.days, 5);
  assert.deepEqual([p.next.id, p.next.on], ["1m", "2026-11-16"]);
  assert.equal(phaseOf(START, on(730)).next, undefined);
});

test("使い始めた日より前は立ち上げ", () => {
  assert.equal(phaseOf(START, "2026-10-01").phase.id, "setup");
});

test("前の段階の項目は残る(飛ばして次に行かない)・先の段階はまだ", () => {
  assert.equal(reached("setup", "3m"), true);
  assert.equal(reached("1m", "3m"), true);
  assert.equal(reached("3m", "3m"), true);
  assert.equal(reached("6m", "3m"), false);
  assert.equal(reached("nope", "3m"), false);
});

test("日数の計算は月またぎ・うるう年でもずれない", () => {
  assert.equal(daysBetween("2028-02-28", "2028-03-01"), 2);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("今日は日本時間(UTC の日曜 23 時は、日本の月曜)", () => {
  assert.equal(todayInTokyo(new Date("2026-10-25T23:00:00Z")), "2026-10-26");
});

// 獲得のコスト(仕様 0043)のテスト。node --test scripts/cost/acquisition.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { acquisitionCost, readAcquisition } from "./acquisition.mjs";
import { renderHtml } from "./render.mjs";
import { makeSummary } from "./summary.mjs";

const CSV = [
  "# 見本",
  "month,channel,ad_jpy,sales_hours,won",
  "2026-08,B-0003,90000,10,3",
  "2026-09,B-0003,60000,5,1",
  "2026-10,B-0003,30000,5,2",
  "2026-10,紹介,0,8,2",
  "2026-07,紹介,0,40,9", // 3か月より前
  "2026-10,,1,1,1", // 届け方が空
  "2026-10,展示会,-5,0,0", // 負の数
].join("\n");

test("acquisition.csv: 形の合う行だけ。無ければ null", () => {
  const rows = readAcquisition(CSV);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[0], { month: "2026-08", channel: "B-0003", ad: 90000, hours: 10, won: 3 });
  assert.equal(readAcquisition(null), null);
  assert.deepEqual(readAcquisition(""), []);
});

test("届け方ごとに直近3か月を足し、1社を取るのにいくら(広告費+営業の時間 × 時給 ÷ 獲得)", () => {
  const a = acquisitionCost(readAcquisition(CSV), { month: "2026-10", rates: { default: 4000 } });
  assert.equal(a.from, "2026-08");
  assert.deepEqual(a.channels, [
    {
      channel: "B-0003",
      ad_jpy: 180000,
      sales_hours: 20,
      won: 6,
      sales_jpy: 80000,
      total_jpy: 260000,
      per_won_jpy: 43333,
      small: false,
    },
    {
      channel: "紹介",
      ad_jpy: 0,
      sales_hours: 8,
      won: 2,
      sales_jpy: 32000,
      total_jpy: 32000,
      per_won_jpy: 16000,
      small: true,
    },
  ]);
  assert.deepEqual(a.total, { ad_jpy: 180000, total_jpy: 292000, won: 8, per_won_jpy: 36500 });
  // 時給が無ければ営業の時間は円にしない(広告費だけ)
  const noRate = acquisitionCost(readAcquisition(CSV), { month: "2026-10", rates: null });
  assert.equal(noRate.rate_known, false);
  assert.equal(noRate.channels[0].sales_jpy, null);
  assert.equal(noRate.channels[0].per_won_jpy, 30000);
  // 獲得が0なら1社あたりは出さない
  const none = acquisitionCost(
    readAcquisition("month,channel,ad_jpy,sales_hours,won\n2026-10,記事,5000,0,0"),
    {
      month: "2026-10",
      rates: null,
    },
  );
  assert.equal(none.channels[0].per_won_jpy, null);
});

test("まとめとページ: 入力があれば表、無ければ足りない物に書く", () => {
  const people = (acquisition) => ({
    inputs: { rates: { default: 4000 }, time: null, revenue: null, acquisition },
    allocation: "none",
    stages: {},
  });
  const s = makeSummary(
    {},
    { today: "2026-10-10", generatedAt: "t", people: people(readAcquisition(CSV)) },
  );
  assert.equal(s.acquisition.channels.length, 2);
  const html = renderHtml(s);
  assert.match(html, /獲得のコスト\(届け方ごと。2026-08〜2026-10/);
  assert.match(html, /\(2組織。少ない\)/);
  const none = makeSummary({}, { today: "2026-10-10", generatedAt: "t", people: people(null) });
  assert.equal(none.acquisition, null);
  assert.ok(none.notes.some((n) => n.includes("acquisition.csv")));
});

test("見本の acquisition.csv はそのまま読める", () => {
  const rows = readAcquisition(readFileSync("docs/cost/inputs-example/acquisition.csv", "utf8"));
  assert.ok(rows.length > 0);
});

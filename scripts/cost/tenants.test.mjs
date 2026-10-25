// 1社あたりの原価(仕様 0042)のテスト。node --test scripts/cost/tenants.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { centsToJpy, periodOf } from "./period.mjs";
import { renderHtml } from "./render.mjs";
import { makeSummary } from "./summary.mjs";
import { parseShares, targetOf, tenantCost } from "./tenants.mjs";

// tenant-shares の1行目(API の運営のコマンド。組織の ID は無い)
const SHARES = {
  month: "2026-09",
  tenantsTotal: 6,
  smallBelow: 5,
  totals: { users: 40, rows: 1000, writes: 200 },
  bands: [
    { band: "1〜5人", tenants: 5, small: false, users: 20, rows: 400, writes: 50 },
    { band: "21〜100人", tenants: 1, small: true, users: 20, rows: 600, writes: 150 },
  ],
  largestPct: { users: 50, rows: 60, writes: 75 },
};

test("帯ごとの1社あたりは、3つの元(人数・行の数・書き込み)の割合の幅", () => {
  const t = tenantCost(SHARES, { jpy: 100_000, how: "実績" });
  assert.deepEqual(t.bands, [
    // 人数 50%・行 40%・書き込み 25% を5社で割る
    { band: "1〜5人", tenants: 5, small: false, low: 5000, high: 10000 },
    { band: "21〜100人", tenants: 1, small: true, low: 50000, high: 75000 },
  ]);
  assert.deepEqual(t.average, { low: 16667, high: 16667 });
  assert.deepEqual(t.largest, { low: 50000, high: 75000 });
  assert.deepEqual(t.bases, ["人数", "データの行の数", "書き込みの数"]);
  // 書き込みが0なら、その元は使わない
  const noWrites = tenantCost(
    { ...SHARES, totals: { ...SHARES.totals, writes: 0 } },
    { jpy: 100_000, how: "" },
  );
  assert.deepEqual(noWrites.bases, ["人数", "データの行の数"]);
});

test("按分する金額: 過ぎた月は本番の実績・今月は月末の見込み・無ければ null", () => {
  const period = periodOf("2026-10-10");
  const toJpy = (c) => centsToJpy(c, 150);
  const prodMonths = [{ month: "2026-09", total_cents: 100_000 }];
  assert.deepEqual(targetOf({ shares: SHARES, prodMonths, prodThisMonthJpy: 0, period, toJpy }), {
    jpy: 150_000,
    how: "実績",
  });
  assert.deepEqual(
    targetOf({
      shares: { ...SHARES, month: "2026-10" },
      prodMonths,
      prodThisMonthJpy: 10_000,
      period,
      toJpy,
    }),
    { jpy: 31_000, how: "今月の見込み" },
  );
  assert.equal(
    targetOf({
      shares: { ...SHARES, month: "2026-07" },
      prodMonths,
      prodThisMonthJpy: 0,
      period,
      toJpy,
    }),
    null,
  );
});

test("tenants.json は tenant-shares の1行目をそのまま読む。形が違えば null", () => {
  assert.deepEqual(parseShares(JSON.stringify({ mode: "tenant-shares", ...SHARES })), SHARES);
  assert.equal(parseShares(JSON.stringify({ month: "2026-09" })), null);
  assert.equal(parseShares(null), null);
});

const inputs = (tenants) => ({ rates: null, time: null, revenue: null, tenants });
const people = (tenants) => ({ inputs: inputs(tenants), allocation: "none", stages: {} });
const awsProd = {
  ok: true,
  data: {
    account: "prod",
    months: [
      { month: "2026-09", total_cents: 100_000, by_service: {} },
      { month: "2026-10", total_cents: 20_000, by_service: {} },
    ],
    this_month: { by_environment: {}, by_component: {}, by_bet: {}, daily: [] },
    forecast_rest_cents: null,
  },
};

test("まとめとページ: 元と本番の AWS があれば表を出す。無ければ足りない物に書く(組織の ID は無い)", () => {
  const s = makeSummary(
    { "aws-prod": awsProd },
    { today: "2026-10-10", generatedAt: "t", people: people(SHARES) },
  );
  assert.equal(s.tenant_cost.target_jpy, 150_000); // 9月の本番 $1,000(1ドル 150円)
  assert.equal(s.tenant_cost.bands.length, 2);
  const html = renderHtml(s);
  assert.match(html, /1社あたりの原価/);
  assert.match(html, /5組織未満/);
  assert.match(html, /いちばん大きい組織/);

  const none = makeSummary(
    { "aws-prod": awsProd },
    { today: "2026-10-10", generatedAt: "t", people: people(null) },
  );
  assert.equal(none.tenant_cost, null);
  assert.ok(none.notes.some((n) => n.includes("tenants.json")));
  assert.equal(renderHtml(none).includes("1社あたりの原価(本番"), false);

  const old = makeSummary(
    { "aws-prod": awsProd },
    { today: "2026-10-10", generatedAt: "t", people: people({ ...SHARES, month: "2026-01" }) },
  );
  assert.equal(old.tenant_cost, null);
  assert.ok(old.notes.some((n) => n.includes("2026-01")));
});

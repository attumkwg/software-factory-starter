// 賭けごとの予算の枠(仕様 0054)のテスト。node --test scripts/cost/budgets.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { budgetAlerts, budgetStatus, readBudgets } from "./budgets.mjs";
import { periodOf } from "./period.mjs";
import { renderHtml } from "./render.mjs";
import { parseCsv } from "./source-people.mjs";
import { makeSummary } from "./summary.mjs";

const CSV = [
  "bet,monthly_jpy,from,until,warn_pct",
  "B-0002,100000,2026-10,2027-03,",
  "B-0003,50000,2026-09,2026-12,90",
  "B-0004,10000,2026-01,2026-09,", // 期限を過ぎた
  "B-0005,10000,2026-11,2027-01,", // まだ始まっていない
  "B-0006,0,2026-10,2026-12,", // 枠が0
  "core,10000,2026-10,2026-12,", // 賭けでない
].join("\n");

const plRow = (bet, x) => ({ bet, infra: 0, saas: 0, shared: 0, people_high: 0, ...x });

test("budgets.csv: 形の合う行だけ。注意の線の既定は 80%。無ければ null", () => {
  const b = readBudgets(CSV, parseCsv);
  assert.equal(b.rows.length, 4);
  assert.equal(b.bad, 2);
  assert.deepEqual(b.rows[0], {
    bet: "B-0002",
    monthly: 100000,
    from: "2026-10",
    until: "2027-03",
    warn: 80,
  });
  assert.equal(readBudgets(null, parseCsv), null);
  const sample = readBudgets(
    readFileSync("docs/cost/inputs-example/budgets.csv", "utf8"),
    parseCsv,
  );
  assert.equal(sample.bad, 0);
});

test("月末の見込み: 月の中で増える分を日割りで伸ばし、月額の SaaS は足すだけ。超える・注意・枠の中・期限切れ", () => {
  const period = periodOf("2026-10-10"); // 31日のうち10日目
  const pl = {
    rows: [
      plRow("B-0002", { infra: 10000, people_high: 20000, saas: 5000 }), // (30000 × 31/10) + 5000 = 98000
      plRow("B-0003", { shared: 10000 }), // 31000 / 50000 = 62%
    ],
  };
  const s = budgetStatus(readBudgets(CSV, parseCsv), { pl, period });
  assert.deepEqual(
    s.rows.map((r) => [r.bet, r.status, r.pct ?? null]),
    [
      ["B-0002", "warn", 98],
      ["B-0003", "ok", 62],
      ["B-0004", "ended", null],
    ],
  );
  assert.equal(s.rows[0].spent_jpy, 35000);
  assert.equal(s.rows[0].projected_jpy, 98000);
  const over = budgetStatus(readBudgets(CSV, parseCsv), {
    pl: { rows: [plRow("B-0002", { infra: 40000 })] },
    period,
  });
  assert.equal(over.rows[0].status, "over");
  // PL に無い賭けは 0
  assert.equal(budgetStatus(readBudgets(CSV, parseCsv), { pl: null, period }).rows[1].pct, 0);
});

test("知らせの文は賭けの ID と割合だけ(金額は出さない)", () => {
  const lines = budgetAlerts(
    {
      rows: [
        {
          bet: "B-0002",
          status: "over",
          pct: 120,
          warn_pct: 80,
          monthly_jpy: 100000,
          projected_jpy: 120000,
        },
        { bet: "B-0003", status: "warn", pct: 85, warn_pct: 80, monthly_jpy: 50000 },
        { bet: "B-0004", status: "ok", pct: 10, warn_pct: 80 },
      ],
    },
    "2026-10",
  );
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^⚠ 賭け B-0002: 2026-10 は予算の枠を超える見込み\(枠の 120%\)/);
  assert.match(lines[1], /B-0003: 2026-10 は予算の枠の 85% の見込み\(注意の線 80%\)/);
  for (const l of lines) assert.equal(/\d{4,}円|100000|120000|50000/.test(l), false);
  assert.deepEqual(budgetAlerts(null, "2026-10"), []);
});

test("まとめとページと CLI: 表が出て、--budget-alerts は金額を出さない", () => {
  const people = {
    inputs: {
      rates: { default: 6000 },
      time: null,
      revenue: null,
      budgets: readBudgets(CSV, parseCsv),
    },
    allocation: "none",
    stages: {},
  };
  const s = makeSummary({}, { today: "2026-10-10", generatedAt: "t", people });
  assert.equal(s.budgets.rows.length, 3);
  assert.ok(s.notes.some((n) => n.includes("形の合わない行 2行")));
  assert.match(renderHtml(s), /賭けごとの予算の枠/);
  const dir = mkdtempSync(join(tmpdir(), "budgets-"));
  const summary = {
    month: "2026-10",
    budgets: {
      rows: [{ bet: "B-0002", status: "over", pct: 130, warn_pct: 80, monthly_jpy: 100000 }],
    },
  };
  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary));
  const out = execFileSync("node", ["scripts/cost/run.mjs", "--budget-alerts", dir], {
    encoding: "utf8",
  });
  assert.match(out, /B-0002/);
  assert.equal(out.includes("100000"), false);
});

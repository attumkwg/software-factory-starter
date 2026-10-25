// 人の時間の実績と開発の段階(仕様 0044)のテスト。node --test scripts/cost/actuals.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { actualPhases, phaseOfStage, readActuals } from "./actuals.mjs";
import { makeLedgerCsv } from "./ledger.mjs";
import { makePl } from "./pl.mjs";
import { renderHtml } from "./render.mjs";
import { parseCsv } from "./source-people.mjs";
import { makeSummary } from "./summary.mjs";

const CSV = [
  "date,person,bet,phase,hours,approved_by",
  "2026-10-05,@a,B-0002,研究開発,10,@lead",
  "2026-10-05,@a,B-0002,制作,6,",
  "2026-10-12,@b,core,運用,4,@lead",
  "2026-09-28,@a,B-0002,研究開発,40,@lead", // 先月
  "2026-10-12,@b,B-0002,設計,3,@lead", // 段階が違う
  "2026-10-12,@b,B-0002,制作,-1,@lead", // 負の時間
].join("\n");

test("actuals.csv: その月の形の合う行だけ。合わない行は数える。無ければ null", () => {
  const a = readActuals(CSV, "2026-10", parseCsv);
  assert.equal(a.rows.length, 3);
  assert.equal(a.bad, 2);
  assert.deepEqual(a.rows[1], {
    date: "2026-10-05",
    person: "@a",
    bet: "B-0002",
    phase: "制作",
    hours: 6,
    approved_by: null,
  });
  assert.equal(readActuals(null, "2026-10", parseCsv), null);
  const sample = readActuals(
    readFileSync("docs/cost/inputs-example/actuals.csv", "utf8"),
    "2026-10",
    parseCsv,
  );
  assert.equal(sample.bad, 0);
  assert.equal(sample.rows.length, 3);
});

test("開発の段階の案: idea〜psf は研究開発・rollout と adopted は制作・ほかは運用", () => {
  assert.equal(phaseOfStage("psf"), "研究開発");
  assert.equal(phaseOfStage("rollout"), "制作");
  assert.equal(phaseOfStage("adopted"), "制作");
  assert.equal(phaseOfStage("retired"), "運用");
  assert.deepEqual(
    actualPhases(readActuals(CSV, "2026-10", parseCsv)).map((g) => [
      g.bet,
      g.phase,
      g.rows,
      g.unapproved,
    ]),
    [
      ["B-0002", "研究開発", 1, 0],
      ["B-0002", "制作", 1, 1],
      ["core", "運用", 1, 0],
    ],
  );
});

const inputs = (actuals) => ({ rates: { default: 6000 }, time: null, revenue: null, actuals });

test("PL: 実績があれば人の費用は実績(幅にしない)。無ければ今までどおり", () => {
  const prs = [{ number: 1, bet: "B-0002", minutes: { "@a": 120 }, proposal: "費用" }];
  const base = {
    awsByBet: {},
    saasItems: [],
    actionsJpy: 0,
    prs,
    allocation: "none",
    stages: { "B-0002": "psf" },
  };
  const withActual = makePl({ ...base, inputs: inputs(readActuals(CSV, "2026-10", parseCsv)) });
  const row = withActual.rows.find((r) => r.bet === "B-0002");
  assert.equal(row.hours_actual, 16);
  assert.equal(row.people_actual_yen, 96000);
  assert.equal(row.people_low, 96000);
  assert.equal(row.people_high, 96000);
  assert.equal(withActual.total.hours_actual, 20);
  const without = makePl({ ...base, inputs: inputs(null) }).rows.find((r) => r.bet === "B-0002");
  assert.equal(without.hours_actual, null);
  assert.equal(without.people_low, 12000); // 自動の目安 2時間
});

test("ledger.csv: 実績を賭け × 開発の段階ごとに・未確認と段階の案との違いを根拠に書く", () => {
  const actuals = readActuals(CSV, "2026-10", parseCsv);
  const pl = makePl({
    awsByBet: {},
    saasItems: [],
    actionsJpy: 0,
    prs: [],
    inputs: inputs(actuals),
    allocation: "none",
    stages: { "B-0002": "psf" },
  });
  const csv = makeLedgerCsv({ month: "2026-10", prs: [], rates: { default: 6000 }, pl, actuals });
  const lines = csv.trim().split("\n");
  assert.ok(
    lines.includes(
      "2026-10,B-0002,psf,人の時間(実績・制作),資産の候補,6,36000,,週の記録 1行・未確認 1行・賭けの段階からの案は「研究開発」",
    ),
  );
  assert.ok(
    lines.includes("2026-10,B-0002,psf,人の時間(実績・研究開発),費用,10,60000,,週の記録 1行"),
  );
  assert.ok(lines.includes("2026-10,core,,人の時間(実績・運用),費用,4,24000,,週の記録 1行"));
});

test("まとめとページ: 実績が無ければ足りない物に書く。未確認・形の合わない行も書く。ページに「実績」", () => {
  const people = (actuals) => ({ inputs: inputs(actuals), allocation: "none", stages: {} });
  const none = makeSummary({}, { today: "2026-10-20", generatedAt: "t", people: people(null) });
  assert.ok(none.notes.some((n) => n.includes("actuals.csv")));
  const s = makeSummary(
    {},
    {
      today: "2026-10-20",
      generatedAt: "t",
      people: people(readActuals(CSV, "2026-10", parseCsv)),
    },
  );
  assert.ok(s.notes.some((n) => n.includes("形の合わない行 2行")));
  assert.ok(s.notes.some((n) => n.includes("確かめた人の無い行 1行")));
  assert.match(renderHtml(s), /実績 16h/);
});

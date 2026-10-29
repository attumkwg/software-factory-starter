import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBet } from "./bets-lib.mjs";
import { mondayOf } from "./checkup/phase.mjs";
import {
  betFactOf,
  fullWeeks,
  kpiFieldOf,
  kpiMismatches,
  northStarWeeks,
  perTenHours,
  prFactOf,
  roiTotals,
  sinceOf,
  usedOn,
} from "./roi-lib.mjs";

// ── 資産の累計と ROI・PR の「動かす KPI」・北極星の分母と分子(pnpm kpi --roi。仕様 0094)──

const config = {
  minutes: { ai_pr_check: 15, human_pr: 120, bot_pr_check: 5, review: 20, comment: 3 },
  ai_markers: ["Generated with [Claude Code]"],
};
const ghPr = (over = {}) => ({
  number: 1,
  author: { login: "owner", is_bot: false },
  labels: [{ name: "ai:assisted" }],
  body: "- 取り組み: 基盤\n- 作業の種類: 保守\n- 動かす KPI: なし",
  comments: [],
  reviews: [],
  mergedAt: "2026-10-20T03:00:00Z",
  ...over,
});
const fact = (over = {}) => ({
  number: 1,
  bot: false,
  bet: null,
  proposal: "費用",
  kpiField: "なし",
  kpis: [],
  minutes: { low: 15, high: 15 },
  day: "2026-10-20",
  week: "2026-10-19",
  ...over,
});
const reached = (over = {}) => ({
  id: "B-0001",
  stage: "adopted",
  kpis: ["K-2", "K-G3"],
  gain: { low: 1, high: 3 },
  reachedOn: "2026-07-01",
  ...over,
});

test("週の月曜は日付のまま数える(日曜は6日前・月をまたぐ・年をまたぐ)", () => {
  assert.equal(mondayOf("2026-10-26"), "2026-10-26");
  assert.equal(mondayOf("2026-11-01"), "2026-10-26");
  assert.equal(mondayOf("2027-01-01"), "2026-12-28");
  assert.deepEqual(fullWeeks("2026-10-26", 2), ["2026-10-12", "2026-10-19"]);
});

test("PR の「動かす KPI」を読む(注・バッククォートは外す。無ければ空)", () => {
  assert.equal(kpiFieldOf("- 動かす KPI: `K-2` <!-- 賭けの KPI -->"), "K-2");
  assert.equal(kpiFieldOf("- 動かす KPI: <!-- 注だけ -->"), "");
  assert.equal(kpiFieldOf("- 取り組み: 基盤"), "");
});

test("PR 1件の事実: 週は日本時間で決め、分は費用のページと同じ式・幅の上は問い1つ × 5分", () => {
  const body = [
    "- 取り組み: bet:B-0001",
    "- 作業の種類: 作り込み",
    "- 動かす KPI: K-2",
    "## 🧑‍⚖️ 人に判断してほしい所",
    "| # | 種類 | 問い |",
    "|---|---|---|",
    "| 1 | 事業判断 | a |",
    "| 2 | 事業判断 | b |",
  ].join("\n");
  // 日曜の UTC 16時 = 日本の月曜 1時 → 週は 10-26
  const f = prFactOf(ghPr({ body, comments: [{}, {}], mergedAt: "2026-10-25T16:00:00Z" }), {
    config,
    stages: { "B-0001": "adopted" },
  });
  assert.equal(f.day, "2026-10-26");
  assert.equal(f.week, "2026-10-26");
  assert.equal(f.bet, "B-0001");
  assert.equal(f.proposal, "資産の候補");
  assert.deepEqual(f.kpis, ["K-2"]);
  assert.deepEqual(f.minutes, { low: 15 + 2 * 3, high: 15 + 2 * 3 + 2 * 5 });
  const bot = prFactOf(ghPr({ author: { login: "app/renovate", is_bot: true }, body: "" }), {
    config,
    stages: {},
  });
  assert.equal(bot.bot, true);
  assert.deepEqual(bot.minutes, { low: 5, high: 5 });
});

test("PR の「動かす KPI」が空・賭けと合わない物だけを出す(ボット・KPI の無い賭けは見ない)", () => {
  const bets = [reached(), reached({ id: "B-0002", stage: "cpf", kpis: [] })];
  const list = kpiMismatches(
    [
      fact({ number: 1 }),
      fact({ number: 2, kpiField: "" }),
      fact({ number: 3, bet: "B-0001", kpiField: "K-1", kpis: ["K-1"] }),
      fact({ number: 4, bet: "B-0001", kpiField: "K-G3", kpis: ["K-G3"] }),
      fact({ number: 5, bet: "B-0001", kpiField: "なし" }),
      fact({ number: 6, bet: "B-0002", kpiField: "なし" }),
      fact({ number: 7, bot: true, kpiField: "" }),
      fact({ number: 8, kpiField: "K-1", kpis: ["K-1"] }),
    ],
    bets,
  );
  assert.deepEqual(
    list.map((m) => [m.number, m.reason.split("(")[0]]),
    [
      [2, "空"],
      [3, "合わない"],
      [5, "合わない"],
    ],
  );
  assert.match(list[1].reason, /PR は K-1・賭けは K-2・K-G3/);
});

test("賭けごとの原価の累計と ROI(roiRange)。出せない賭けは理由を出し、合計に入れない", () => {
  const day = 8 * 60;
  const prs = [
    fact({ bet: "B-0001", proposal: "資産の候補", minutes: { low: day, high: day } }),
    fact({ bet: "B-0001", minutes: { low: day, high: 2 * day } }),
    fact({ minutes: { low: day / 2, high: day } }),
  ];
  const bets = [
    reached(),
    reached({ id: "B-0002", stage: "psf", reachedOn: undefined }),
    reached({ id: "B-0003", gain: undefined }),
    reached({ id: "B-0004" }),
  ];
  // 2026-07-01 → 2026-10-29 は 120日 = 4か月
  const r = roiTotals(bets, prs, "2026-10-29");
  const b1 = r.rows[0];
  assert.deepEqual([b1.prs, b1.assets, b1.cost], [2, 1, { low: 2, high: 3 }]);
  assert.equal(b1.months, 4);
  // 悪い方 = (1 × 4 − 3) ÷ 3・良い方 = (3 × 4 − 2) ÷ 2
  assert.equal(b1.roiLow, 1 / 3);
  assert.equal(b1.roiHigh, 5);
  assert.deepEqual(
    r.rows.slice(1).map((x) => x.why),
    [
      "rollout の前(得た物はまだ数えない)",
      "「- 得る物の見込み(月):」が無い",
      "原価が数えられない(この賭けの PR が無い)",
    ],
  );
  assert.equal(r.total.roiLow, 1 / 3);
  assert.deepEqual(r.core, { low: 0.5, high: 1 });
  assert.equal(roiTotals([bets[1]], prs, "2026-10-29").total, null);
});

test("北極星: 分子は rollout の後に KPI へ最初の記録が付いた週・分母はその週の PR の人の時間", () => {
  const records = [
    { date: "2026-06-30", kpi: "K-2", value: 10 }, // rollout の前は数えない
    { date: "2026-10-20", kpi: "K-2", value: 50 },
    { date: "2026-10-21", kpi: "K-2", value: 55 },
  ];
  assert.equal(usedOn(reached(), records), "2026-10-20");
  assert.equal(usedOn(reached({ stage: "psf" }), records), undefined);
  assert.equal(usedOn(reached({ kpis: ["K-1"] }), records), undefined);
  const prs = [
    fact({ week: "2026-10-19", minutes: { low: 60, high: 90 } }),
    fact({ week: "2026-10-19", minutes: { low: 30, high: 30 } }),
    fact({ week: "2026-10-26", minutes: { low: 600, high: 600 } }), // 今週は数え終わっていない
  ];
  const s = northStarWeeks({ bets: [reached()], prs, records, today: "2026-10-29", weeks: 2 });
  assert.deepEqual(
    s.rows.map((r) => [r.monday, r.used, r.prs, r.hours]),
    [
      ["2026-10-12", 0, 0, { low: 0, high: 0 }],
      ["2026-10-19", 1, 2, { low: 1.5, high: 2 }],
    ],
  );
  assert.deepEqual(s.total, { used: 1, prs: 2, hours: { low: 1.5, high: 2 } });
  assert.deepEqual(perTenHours(1, { low: 1.5, high: 2 }), { low: 5, high: 6.7 });
  assert.equal(perTenHours(0, { low: 0, high: 0 }), null);
});

test("賭けのファイルから数える物を読み、PR を読む始まりの日を決める", () => {
  const bet = parseBet(
    [
      "## いまの状態",
      "- 段階: adopted",
      "- 動かす KPI: K-2(守り K-G3)",
      "- 得る物の見込み(月): 1〜3 人日相当(架空)",
      "## 小石(判断の記録)",
      "| 日付 | 段階 | 何をした | 結果 | 判断 | 証拠 |",
      "|---|---|---|---|---|---|",
      "| 2026-07-08 | idea | 開いた | — | 開く | — |",
      "| 2026-09-02 | rollout | 出した | — | 続ける | — |",
      "| 2026-10-16 | adopted | 全部に | — | 続ける | — |",
    ].join("\n"),
  );
  assert.deepEqual(betFactOf("B-0001", bet), {
    id: "B-0001",
    stage: "adopted",
    kpis: ["K-2", "K-G3"],
    gain: { low: 1, high: 3 },
    reachedOn: "2026-09-02",
  });
  assert.equal(sinceOf([{ bet }], "2026-10-29", 8), "2026-07-08");
  assert.equal(sinceOf([], "2026-10-29", 2), "2026-10-12");
});

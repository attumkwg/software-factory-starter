// 人の時間・賭けごとの PL・/ledger の案の CSV のテスト(GitHub は偽物)。node --test scripts/cost/pl.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fakeCtx, ok } from "../checkup/fake-context.mjs";
import { makeLedgerCsv } from "./ledger.mjs";
import { makePl } from "./pl.mjs";
import { renderHtml } from "./render.mjs";
import { UNTAGGED } from "./source-aws.mjs";
import { loadPeopleConfig, parseCsv, peoplePrs, prMinutes, readInputs } from "./source-people.mjs";
import { makeSummary } from "./summary.mjs";

const config = loadPeopleConfig("");
const BET = `# 賭け\n\n## いまの状態\n\n- 段階: rollout\n`;

test("PR 1件の分数: AI の PR は確認だけ・人の PR は書く時間・レビューとコメント・ボット", () => {
  const ai = prMinutes(
    { user: { login: "a" }, body: "🤖 Generated with [Claude Code]", comments: 2 },
    [{ user: { login: "b" } }, { user: { login: "a" } }, { user: { login: "x[bot]" } }],
    config,
  );
  assert.equal(ai.ai, true);
  assert.deepEqual(ai.minutes, { "@a": 15 + 2 * 3, "@b": 20 });
  const human = prMinutes({ user: { login: "a" }, body: "", comments: 0 }, [], config);
  assert.deepEqual(human.minutes, { "@a": 120 });
  const bot = prMinutes({ user: { login: "renovate[bot]" }, body: "", comments: 5 }, [], config);
  assert.deepEqual(bot.minutes, { "(ボットの PR の確認)": 5 });
});

test("peoplePrs: 今月作った PR を本文の取り組みで賭けか土台に分け、段階と区分の案を付ける", async () => {
  let asked = "";
  const body = (work, kind) =>
    `- 取り組み: ${work}\n- 作業の種類: ${kind}\nGenerated with [Claude Code]`;
  const ctx = fakeCtx({
    today: "2026-10-25",
    files: { "docs/product/bets/B-0002-x.md": BET },
    gh: {
      "search/issues": (p) => {
        asked = p;
        return ok({
          items: [
            { number: 1, user: { login: "a" }, body: body("bet:B-0002", "作り込み"), comments: 0 },
            { number: 2, user: { login: "a" }, body: body("保守", "保守"), comments: 0 },
          ],
        });
      },
    },
    api: { "pulls/1/reviews": ok([{ user: { login: "b" } }]), "pulls/2/reviews": ok([]) },
  });
  const res = await peoplePrs(ctx);
  assert.match(asked, /created:>=2026-10-01/);
  assert.deepEqual(
    res.data.prs.map((p) => [p.number, p.bet, p.stage, p.proposal]),
    [
      [1, "B-0002", "rollout", "資産の候補"],
      [2, "core", null, "費用"],
    ],
  );
  assert.deepEqual(res.data.prs[0].minutes, { "@a": 15, "@b": 20 });
});

test("入力: CSV と JSON を読み、今月の分だけ・無い物は null", () => {
  const dir = mkdtempSync(join(tmpdir(), "inputs-"));
  writeFileSync(join(dir, "rates.json"), JSON.stringify({ default: 4000 }));
  writeFileSync(
    join(dir, "time.csv"),
    "# 見本\nweek_start,person,bet,percent,hours\n2026-10-19,@a,B-0002,50,40\n2026-09-28,@a,B-0002,100,40\n",
  );
  const inputs = readInputs(dir, "2026-10");
  assert.deepEqual(inputs.time, [{ person: "@a", bet: "B-0002", hours: 20 }]);
  assert.equal(inputs.revenue, null);
  assert.equal(inputs.rates.default, 4000);
  assert.deepEqual(readInputs(undefined, "2026-10"), { rates: null, time: null, revenue: null });
  assert.deepEqual(parseCsv("a,b\n1,2\n"), [{ a: "1", b: "2" }]);
});

const pr = (number, bet, minutes, proposal = "費用") => ({ number, bet, minutes, proposal });

test("PL: 直接の原価・共通の配り分・人の幅・売上から、賭けごとと全体の粗利と判定", () => {
  const pl = makePl({
    awsByBet: { "B-0001": 10000, core: 20000, [UNTAGGED]: 5000 },
    saasItems: [{ name: "席", monthly_jpy: 5000, bet: "core" }],
    actionsJpy: 0,
    prs: [pr(1, "B-0001", { "@a": 60 }), pr(2, "B-0002", { "@a": 180 })],
    inputs: {
      rates: { default: 6000 },
      time: [{ person: "@a", bet: "B-0001", hours: 10 }],
      revenue: [{ bet: "B-0001", jpy: 100000 }],
    },
    allocation: "people_auto",
    stages: { "B-0001": "adopted" },
  });
  const b1 = pl.rows.find((r) => r.bet === "B-0001");
  // 共通 30,000円 を人の時間(自動 1h : 3h)で配る → 7,500円
  assert.equal(pl.shared_jpy, 30000);
  assert.equal(b1.shared, 7500);
  assert.equal(b1.people_low, 6000); // 自動 1h × 6,000
  assert.equal(b1.people_high, 60000); // 手入力 10h × 6,000
  assert.equal(b1.cost_low, 10000 + 7500 + 6000);
  assert.equal(b1.profit_high, 100000 - 23500);
  assert.equal(b1.verdict, "黒字");
  const b2 = pl.rows.find((r) => r.bet === "B-0002");
  assert.equal(b2.verdict, "売上なし");
  assert.equal(pl.rows.find((r) => r.bet === "core").shared, 0);
  assert.equal(pl.total.revenue, 100000);
});

test("PL: 単価が無ければ人の費用は出さず「単価なし」・配らない設定なら土台に残す・赤字の判定", () => {
  const base = {
    awsByBet: { "B-0001": 50000, core: 10000 },
    saasItems: [],
    actionsJpy: 0,
    prs: [pr(1, "B-0001", { "@a": 60 })],
    stages: {},
  };
  const none = makePl({
    ...base,
    inputs: { rates: null, time: null, revenue: null },
    allocation: "none",
  });
  assert.equal(none.rows[0].verdict, "単価なし");
  assert.equal(none.rows.find((r) => r.bet === "core").shared, 10000);
  const loss = makePl({
    ...base,
    inputs: { rates: { default: 1000 }, time: null, revenue: [{ bet: "B-0001", jpy: 1000 }] },
    allocation: "people_auto",
  });
  assert.equal(loss.rows[0].verdict, "赤字");
});

test("ledger.csv: 人の時間を区分の案ごとに・運用の費用・根拠の PR・カンマを含む値は囲む", () => {
  const prs = [pr(1, "B-0001", { "@a": 60 }, "資産の候補"), pr(2, "B-0001", { "@a": 30 }, "費用")];
  const pl = makePl({
    awsByBet: { "B-0001": 1000 },
    saasItems: [],
    actionsJpy: 0,
    prs,
    inputs: {
      rates: { default: 6000 },
      time: [{ person: "@a", bet: "B-0001", hours: 3 }],
      revenue: null,
    },
    allocation: "none",
    stages: { "B-0001": "rollout" },
  });
  const csv = makeLedgerCsv({ month: "2026-10", prs, rates: { default: 6000 }, pl }).split("\n");
  assert.match(csv[0], /^月,賭け,段階,もと,区分の案/);
  assert.equal(csv[1], "2026-10,B-0001,rollout,人の時間,資産の候補,1,6000,12000,#1");
  assert.equal(csv[2], "2026-10,B-0001,rollout,人の時間,費用,0.5,3000,6000,#2");
  assert.match(csv[3], /費用\(運用\),,1000/);
});

test("ページ: 賭けごとの PL の表が出て、人ごとの金額は出ない", () => {
  const entries = {
    "people-prs": {
      ok: true,
      data: { prs: [pr(1, "B-0001", { "@secret-person": 600 })], truncated: false },
    },
  };
  const s = makeSummary(entries, {
    today: "2026-10-25",
    generatedAt: "t",
    people: {
      inputs: {
        rates: { default: 1000, people: { "@secret-person": 7777 } },
        time: null,
        revenue: null,
      },
      allocation: "people_auto",
      stages: {},
    },
  });
  const html = renderHtml(s);
  assert.match(html, /賭けごとの損益/);
  assert.doesNotMatch(JSON.stringify(s), /secret-person/);
  assert.doesNotMatch(html, /secret-person/);
  assert.ok(s.notes.some((n) => n.includes("revenue.csv")));
});

test("CLI: --render --inputs で ledger.csv を作り、入力のファイルは出さない・ログに金額を出さない", () => {
  const dir = mkdtempSync(join(tmpdir(), "cost-"));
  writeFileSync(
    join(dir, "people-prs.json"),
    JSON.stringify({ ok: true, data: { prs: [pr(1, "B-0002", { "@a": 120 })], truncated: false } }),
  );
  const log = execFileSync(
    "node",
    [join("scripts", "cost", "run.mjs"), "--render", dir, "--inputs", "docs/cost/inputs-example"],
    { encoding: "utf8" },
  );
  assert.doesNotMatch(log, /円|50000|4000/);
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const files = manifest.files.map((f) => f.file).sort();
  assert.ok(files.includes("ledger.csv"));
  assert.ok(!files.some((f) => /rates|revenue|time\.csv/.test(f)));
});

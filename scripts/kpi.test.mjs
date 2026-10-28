import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";
import { parseBet } from "./bets-lib.mjs";
import {
  allKpis,
  betLinkProblems,
  checkKpi,
  featureNamesOf,
  kpiReport,
  personaIdsOf,
} from "./kpi-lib.mjs";

const personas = new Set(["P-1", "P-2"]);
const features = new Set(["morning-digest"]);
const base = () => ({
  north_star: {
    id: "K-0",
    name: "北極星",
    persona: "P-1",
    measure: { how: "manual", source: "集計" },
    target: { value: 20, by: "2027-03-31" },
    status: "仮説",
  },
  inputs: [
    {
      id: "K-1",
      name: "入力1",
      persona: "P-1",
      measure: { how: "usage", feature: "morning-digest" },
      target: { value: 70, by: "2026-12-31" },
      status: "仮説",
    },
    {
      id: "K-2",
      name: "入力2",
      persona: "P-2",
      measure: { how: "manual", source: "記録" },
      target: { value: 5, by: "2026-12-31", direction: "below" },
      status: "確か",
    },
  ],
  guardrails: [
    {
      id: "K-G1",
      name: "守り",
      measure: { how: "survey", source: "問い" },
      limit: { value: 10, direction: "below" },
      status: "確か",
    },
  ],
  records: [],
});
const check = (doc) => checkKpi(doc, { personas, features });

test("キットの見本の木(docs/product/kpi.yaml)は通る", () => {
  const doc = parse(readFileSync("docs/product/kpi.yaml", "utf8"));
  const result = checkKpi(doc, {
    personas: personaIdsOf(readFileSync("docs/product/personas.md", "utf8")),
    features: featureNamesOf(readFileSync("packages/shared/src/feature-flags.ts", "utf8")),
  });
  assert.deepEqual(result.problems, []);
});

test("北極星1つ・入力 2〜4・守り1つ以上の形でなければ落とす", () => {
  assert.deepEqual(check(base()).problems, []);
  const noStar = { ...base(), north_star: undefined };
  assert.ok(check(noStar).problems.some((p) => p.includes("北極星")));
  const oneInput = { ...base(), inputs: base().inputs.slice(0, 1) };
  assert.ok(check(oneInput).problems.some((p) => p.includes("2〜4")));
  const noGuard = { ...base(), guardrails: [] };
  assert.ok(check(noGuard).problems.some((p) => p.includes("守り")));
});

test("番号の形・重なり・ペルソナ・測り方を確かめる", () => {
  const doc = base();
  doc.inputs[1].id = "K-1";
  doc.inputs[0].persona = "P-9";
  doc.guardrails[0].measure = { how: "manual" };
  const problems = check(doc).problems.join("\n");
  assert.match(problems, /重なっている/);
  assert.match(problems, /P-9/);
  assert.match(problems, /measure.source/);
});

test("まだ無い機能フラグは止めずに知らせる", () => {
  const doc = base();
  doc.inputs[0].measure.feature = "not-yet";
  const result = check(doc);
  assert.deepEqual(result.problems, []);
  assert.ok(result.warnings.some((w) => w.includes("not-yet")));
});

test("金額の指標は、線と値の金額をリポジトリに書かない(届いたかだけ)", () => {
  const doc = base();
  doc.guardrails.push({
    id: "K-G2",
    name: "費用",
    money: true,
    measure: { how: "manual", source: "費用のページ" },
    limit: { value: 300, direction: "below" },
    status: "確か",
  });
  doc.records = [{ date: "2026-10-27", kpi: "K-G2", value: 250 }];
  const problems = check(doc).problems.join("\n");
  assert.match(problems, /線の金額/);
  assert.match(problems, /value を書かない/);
  doc.guardrails[1].limit = { direction: "below" };
  doc.records = [{ date: "2026-10-27", kpi: "K-G2", reached: true }];
  assert.deepEqual(check(doc).problems, []);
});

test("最新の値と線を比べる(少ないほど良い指標・守り・期限)", () => {
  const doc = base();
  doc.records = [
    { date: "2026-10-01", kpi: "K-1", value: 80 },
    { date: "2026-10-20", kpi: "K-1", value: 50 },
    { date: "2026-10-20", kpi: "K-2", value: 3 },
    { date: "2026-10-20", kpi: "K-G1", value: 12 },
  ];
  const judge = Object.fromEntries(kpiReport(doc, "2026-10-28").map((r) => [r.id, r.judge]));
  assert.equal(judge["K-1"], "まだ");
  assert.equal(judge["K-2"], "届いた");
  assert.equal(judge["K-G1"], "超えた");
  assert.equal(judge["K-0"], "まだ測っていない");
  const late = Object.fromEntries(kpiReport(doc, "2027-01-05").map((r) => [r.id, r.judge]));
  assert.equal(late["K-1"], "期限を過ぎた");
});

test("賭けは psf からペルソナと動かす KPI が要り、指す番号は木とペルソナにある物だけ", () => {
  const links = { personas, kpis: new Set(allKpis(base()).map((k) => k.id)) };
  const bet = (stage, extra = "") =>
    parseBet(`# 賭け: B-0009 試し\n\n## いまの状態\n\n- 段階: ${stage}\n${extra}`);
  assert.deepEqual(betLinkProblems(bet("cpf"), links), []);
  assert.equal(betLinkProblems(bet("psf"), links).length, 2);
  assert.deepEqual(
    betLinkProblems(bet("psf", "- ペルソナ: P-1\n- 動かす KPI: K-1(守り K-G1)\n"), links),
    [],
  );
  const wrong = betLinkProblems(bet("rollout", "- ペルソナ: P-7\n- 動かす KPI: K-9\n"), links);
  assert.ok(wrong.some((p) => p.includes("P-7")) && wrong.some((p) => p.includes("K-9")));
});

test("機能フラグの名前は、注の中の見本を数えない", () => {
  const names = featureNamesOf(' *   { name: "morning-digest" }\n  { name: "sso", bet: "B-1" },\n');
  assert.deepEqual([...names], ["sso"]);
});

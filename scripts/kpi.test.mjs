import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";
import { parseBet } from "./bets-lib.mjs";
import {
  councilLinkNotes,
  councilProblems,
  parsePersonas,
  personaProblems,
  STANCES,
} from "./council-lib.mjs";
import {
  allKpis,
  betLinkProblems,
  checkKpi,
  featureNamesOf,
  kpiIdsOf,
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

test("北極星1つ・入力 1〜2・守り 1〜2 に絞っていなければ落とす(残りは見るだけ)", () => {
  assert.deepEqual(check(base()).problems, []);
  const noStar = { ...base(), north_star: undefined };
  assert.ok(check(noStar).problems.some((p) => p.includes("北極星")));
  const oneInput = { ...base(), inputs: base().inputs.slice(0, 1) };
  assert.deepEqual(check(oneInput).problems, []);
  const third = { ...base().inputs[1], id: "K-3" };
  const threeInputs = { ...base(), inputs: [...base().inputs, third] };
  assert.ok(check(threeInputs).problems.some((p) => p.includes("1〜2")));
  const noGuard = { ...base(), guardrails: [] };
  assert.ok(check(noGuard).problems.some((p) => p.includes("守り")));
  // 外した候補は watch に置けば通る(目標も線も要らない)
  const watched = { ...base(), watch: [{ ...third, target: undefined }] };
  assert.deepEqual(check(watched).problems, []);
  const judge = kpiReport(watched, "2026-10-28").find((r) => r.id === "K-3")?.judge;
  assert.equal(judge, "見るだけ");
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

test("kpi.yaml の番号は YAML の部品なしでも読める(木の番号と同じ)", () => {
  const text = readFileSync("docs/product/kpi.yaml", "utf8");
  const fromYaml = allKpis(parse(text))
    .map((k) => k.id)
    .sort();
  assert.deepEqual([...kpiIdsOf(text)].sort(), fromYaml);
});

test("番号の形(北極星 K-0・入力 K-1…・守り K-G1…)", () => {
  const doc = base();
  doc.inputs[0].id = "K-01";
  doc.guardrails[0].id = "K-1";
  const problems = check(doc).problems.join("\n");
  assert.match(problems, /入力 K-01: 番号の形/);
  assert.match(problems, /守り K-1: 番号の形/);
});

// ── 立場の地図と合議の記録(仕様 0082)──
const card = (id, stance, power = "影響", extra = "") =>
  `## ${id} 人\n\n- 立場: ${stance}\n- 決める力: ${power}\n- 根拠: 推測\n${extra}`;
const fullMap = (prefix = "", extra = "") =>
  STANCES.map((s, i) => card(`P-${prefix}${i + 1}`, s, "影響", extra)).join("\n");

test("キットの見本のペルソナは7つの立場がそろい、見本の合議の記録は形が合っている", () => {
  const personas = parsePersonas(readFileSync("docs/product/personas.md", "utf8"));
  assert.deepEqual(personaProblems(personas), []);
  const stanceOf = new Map(personas.map((p) => [p.id, p.stance]));
  const record = readFileSync("docs/product/councils/2026-10-28-kpi.md", "utf8");
  assert.deepEqual(councilProblems(record, stanceOf), []);
});

test("立場が欠けた地図・書き方の違う人は落ちる。やめた人は数えない", () => {
  const short = parsePersonas(
    STANCES.slice(0, 6)
      .map((s, i) => card(`P-${i + 1}`, s))
      .join("\n"),
  );
  assert.match(personaProblems(short).join("\n"), /足りない立場: 運営/);
  const bad = parsePersonas(card("P-1", "社長", "全部"));
  const problems = personaProblems(bad).join("\n");
  assert.match(problems, /立場/);
  assert.match(problems, /決める力/);
  const ended = parsePersonas(`${fullMap()}\n${card("P-9", "運営", "影響", "- 状態: やめた\n")}`);
  assert.deepEqual(personaProblems(ended), []);
});

test("客層が2つあれば、客層ごとに7つの立場が要る", () => {
  const two = parsePersonas(
    `${fullMap("", "- 客層: koumuten\n")}\n${card("P-21", "使う人", "なし", "- 客層: clinic\n")}`,
  );
  assert.match(personaProblems(two).join("\n"), /客層 clinic の足りない立場/);
});

test("合議の記録: 見出し・賛否・根拠・立場のそろい・拒否の扱い・問い・人の判断", () => {
  const stanceOf = new Map(STANCES.map((s, i) => [`P-${i + 1}`, s]));
  const rows = STANCES.map((s, i) => `| P-${i + 1} | ${s} | 条件つき | 成功 | 懸念 | 推測 |`);
  const record = (r = rows, veto = "- なし", questions = "- 問い", decision = "- 判断: 未定") =>
    [
      "## 1. 1人ずつの評価",
      "| ペルソナ | 立場 | 賛否 | 成功 | 懸念 | 根拠 |",
      "|---|---|---|---|---|---|",
      ...r,
      "## 2. 反論役",
      "- 反論",
      "## 3. 議論の回",
      "- なし",
      "## 4. 拒否と、その扱い",
      veto,
      "## 5. 結論の案",
      "案",
      "## 6. 次に確かめる問い",
      questions,
      "## 7. 人の判断",
      decision,
    ].join("\n");
  assert.deepEqual(councilProblems(record(), stanceOf), []);
  const vetoRows = [
    ...rows.slice(0, 3),
    "| P-4 | 買う人 | 拒否 | 成功 | 懸念 | 推測 |",
    ...rows.slice(4),
  ];
  assert.match(councilProblems(record(vetoRows), stanceOf).join("\n"), /拒否した P-4/);
  assert.deepEqual(councilProblems(record(vetoRows, "- P-4: 月払いなら"), stanceOf), []);
  assert.match(councilProblems(record(rows.slice(1)), stanceOf).join("\n"), /足りない立場: 使う人/);
  assert.match(councilProblems(record(rows, "- なし", "なし"), stanceOf).join("\n"), /問い/);
  assert.match(
    councilProblems(record(rows, "- なし", "- 問い", "- 判断: たぶん"), stanceOf).join("\n"),
    /人の判断/,
  );
  const guess = rows.map((r) => r.replace("| 推測 |", "| 勘 |"));
  assert.match(councilProblems(record(guess), stanceOf).join("\n"), /根拠は/);
});

test("「確か」の指標は合議から。合議の記録が無い・無いパスは知らせる", () => {
  const doc = base();
  const notes = councilLinkNotes(doc, new Set());
  assert.ok(notes.some((n) => n.startsWith("K-0:")));
  doc.north_star.council = "docs/product/councils/x.md";
  assert.ok(councilLinkNotes(doc, new Set()).some((n) => n.includes("x.md が無い")));
  assert.ok(
    !councilLinkNotes(doc, new Set(["docs/product/councils/x.md"])).some((n) =>
      n.startsWith("K-0:"),
    ),
  );
});

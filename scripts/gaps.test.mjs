// node --test scripts/gaps.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkGaps,
  currentSummary,
  END,
  gapGroups,
  isGapId,
  isScenario,
  readRows,
  readStages,
  renderSummary,
  replaceSummary,
  START,
  shouldScan,
  specsOf,
  staleRefs,
  statusOf,
  summarize,
} from "./gaps-lib.mjs";

const gapsMd = (rows, stages) =>
  [
    "# 穴の一覧",
    "",
    START,
    "| 古い表 |",
    END,
    "",
    "## 🎯 使える、の条件と足す順番",
    "",
    "| 段 | 穴 | 何をするか | 効く条件 |",
    "|---|---|---|---|",
    ...stages,
    "",
    "## 🔴 お金をもらう前",
    "",
    "| # | 何が無いか | 困る場面 | 足す物の案 | 大きさ |",
    "|---|---|---|---|---|",
    ...rows,
  ].join("\n");

const okRows = [
  "| G-01 | ✅ 済み(仕様 0026): 組織を作るコマンド | a | b | 中 |",
  "| G-06 | ✅ ほぼ済み(仕様 0048。残りは削除のコマンド): 1人分 | a | b | 中 |",
  "| G-62 | 🔧 作業中(#139)。🟡 AI の費用 | a | b | 小 |",
  "| G-72 | → G-116 に束ねた。🟡 番号がぶつかる | a | b | 小 |",
  "| G-80 | 🔴 製品の AI | a | b | 中 |",
  "| G-81 | 🔴 選ぶ形 | a | b | 中 |",
  "| G-116 | 🟡 記録が混ざる(束ねた: G-72) | a | b | 中 |",
  "| G-121 | ⛔ やらない(2026-10-29 に決めた: 作る物が無い): B 社の部品 | a | b | 中 |",
  "| G-75 | → G-121 に束ねた。🟡 やらない親の子 | a | b | 小 |",
];
const okStages = [
  "| 今すぐ | G-06 の残り | 削除のコマンド | 2 |",
  "| 今すぐ | (G-118 の数をそろえる所) | 済み | 6 |",
  "| 使える前に | G-62 | 上限 | 5 |",
  "| 使える前に | G-116(G-72 を束ねた) | 記録 | 7 |",
  "| 使えた後で | G-80〜G-81 | 製品の AI | 場面が来てから |",
];
const states = new Map([
  ["0026", "完了(…)"],
  ["0048", "完了(…)"],
  ["0060", "下書き"],
]);

test("番号の形と、続けて書いた番号のまとまり", () => {
  assert.equal(isGapId("G-06"), true);
  assert.equal(isGapId("G-122"), true);
  assert.equal(isGapId("G-6"), false);
  assert.equal(isGapId("G-06 の残り"), false);
  assert.deepEqual(
    gapGroups("穴 G-01・G-02 と G-80〜G-83、PNG-12").map((g) => g.ids),
    [["G-01", "G-02", "G-80", "G-81", "G-82", "G-83"]],
  );
  assert.deepEqual(
    gapGroups("G-41 で足した。G-42 も").map((g) => g.ids),
    [["G-41"], ["G-42"]],
  );
});

test("行の頭の印から状態を読む", () => {
  assert.equal(statusOf("✅ 済み(仕様 0021): 何か"), "済み");
  assert.equal(statusOf("✅ ほぼ済み(動画だけ)"), "ほぼ済み");
  assert.equal(statusOf("🔧 作業中(#139)"), "作業中");
  assert.equal(statusOf("🟢 頼まれたとき"), "残り");
  assert.equal(statusOf("→ G-51 に束ねた。🟡 情シス"), "束ねた");
  assert.equal(statusOf("⛔ やらない(2026-10-29 に決めた): 何か"), "やらない");
  assert.equal(statusOf("部品のカタログが古い"), undefined);
  assert.deepEqual(specsOf("✅ 済み(仕様 0024・0037(枠)・ADR 0035)"), ["0024", "0037"]);
});

test("正しい一覧は問題なし・数の要約", () => {
  const result = checkGaps(gapsMd(okRows, okStages), states);
  assert.deepEqual(result.problems, []);
  assert.equal(result.stageOf.get("G-72"), "使える前に"); // 束ねた子は親の段
  assert.equal(result.stageOf.get("G-81"), "使えた後で"); // 「〜」の間も数える
  assert.equal(result.stageOf.get("G-121"), undefined); // やらない行とその子は段に入らない
  const summary = summarize(result);
  assert.deepEqual(summary[0], {
    name: "全部",
    全体: 9,
    済み: 1,
    ほぼ済み: 1,
    作業中: 1,
    残り: 4,
    やらない: 2,
  });
  assert.deepEqual(
    summary.map((s) => [s.name, s.全体]),
    [
      ["全部", 9],
      ["今すぐ", 1],
      ["使える前に", 3],
      ["使えた後で", 2],
    ],
  );
});

test("行の形: 重なり・崩れ・🔧 の番号・束ねた先", () => {
  const rows = [
    ...okRows,
    "| G-80 | 🔴 重なった | a | b | 中 |",
    "| G-90 | 何かが無い | a | b | 中 |",
    "| G-91 | 🔧 作業中 | a | b | 中 |",
    "| G-92 | → G-99 に束ねた。🟡 | a | b | 中 |",
  ];
  const stages = [...okStages, "| 使えた後で | G-90・G-91 | x | y |"];
  const problems = checkGaps(gapsMd(rows, stages), states).problems.join("\n");
  assert.match(problems, /G-80 の番号が重なっている/);
  assert.match(problems, /G-90 の印の形が違う/);
  assert.match(problems, /G-91 は 🔧 なのに PR の番号/);
  assert.match(problems, /G-92 の束ねた先\(G-99\)/);
});

test("済みの行の仕様: 下書きと、無い番号で落ちる", () => {
  const rows = [
    ...okRows,
    "| G-58 | ✅ 済み(仕様 0060): 書き手 | a | b | 中 |",
    "| G-59 | ✅ 済み(仕様 0099): 何か | a | b | 中 |",
  ];
  const problems = checkGaps(gapsMd(rows, okStages), states).problems;
  assert.equal(problems.length, 2);
  assert.match(problems[0], /仕様 0060 の状態が「下書き」/);
  assert.match(problems[1], /仕様 0099 が docs\/specs に無い/);
});

test("段: 抜け・無い番号・束ねた子・2つの段", () => {
  const rows = [...okRows, "| G-82 | 🟡 段に無い | a | b | 中 |"];
  const stages = [
    ...okStages,
    "| 今すぐ | G-72 | 束ねた子 | 7 |",
    "| 今すぐ | G-62 | 重なり | 5 |",
    "| 今すぐ | G-200 | 無い | 1 |",
    "| 使えた後で | G-121 | やらない | x |",
  ];
  const problems = checkGaps(gapsMd(rows, stages), states).problems.join("\n");
  assert.match(problems, /G-82 は残っているのに、どの段にも入っていない/);
  assert.match(problems, /G-72 は束ねた行/);
  assert.match(problems, /G-62 が2つの段に入っている/);
  assert.match(problems, /G-200 が穴の一覧に無い/);
  assert.match(problems, /G-121 はやらないと決めた行/);
  assert.deepEqual(checkGaps("# 空\n| G-01 | ✅ 済み | a |", states).problems, [
    "gaps.md に「🎯」の節の段の表が無い",
  ]);
});

test("段の表は「🎯」の節だけを読み、「(」より後の番号を数えない", () => {
  const text = `${gapsMd(okRows, okStages)}\n\n## 別の節\n\n| 今すぐ | G-81 | x | y |`;
  const stages = readStages(text);
  assert.equal(stages.length, okStages.length);
  assert.deepEqual(stages[1].ids, []);
  assert.deepEqual(stages[3].ids, ["G-116"]);
  assert.equal(readRows(text).length, okRows.length);
});

test("今の数の表: 作り直しと、古さ", () => {
  const text = gapsMd(okRows, okStages);
  const block = renderSummary(summarize(checkGaps(text, states)));
  assert.notEqual(currentSummary(text), block);
  const written = replaceSummary(text, block);
  assert.equal(currentSummary(written), block);
  assert.match(block, /^\| 今の数 \| 全体 \| 済み \| ほぼ済み \| 作業中 \| 残り \| やらない \|/);
  assert.equal(currentSummary("印なし"), undefined);
  assert.throws(() => replaceSummary("印なし", block));
});

const done = new Set(["G-01", "G-02", "G-17", "G-41"]);
const stale = (text, opts) => staleRefs(text, done, opts).map((p) => `${p.line} ${p.message}`);

test("済んだ穴を「穴」「埋まるまで」「入れるとき」・❌ で指す所を落とす", () => {
  assert.deepEqual(stale("組織は運営が作る(穴 G-01)"), [
    "1 「穴 G-01」と書いているが、G-01 は済み",
  ]);
  assert.deepEqual(stale("a\n3. 足す(穴 G-01・G-02 が埋まるまでは手で)"), [
    "2 「穴 G-01・G-02」と書いているが、G-01・G-02 は済み",
  ]);
  assert.deepEqual(stale("G-01・G-02 が埋まるまでは手で"), [
    "1 「G-01・G-02 が埋まるまで」と書いているが、G-01・G-02 は済み",
  ]);
  assert.deepEqual(stale("CSP(G-17)を入れるときは"), [
    "1 「G-17 を入れるとき」と書いているが、G-17 は済み",
  ]);
  assert.deepEqual(stale("  - ❌ 版のタグが無い(G-41)"), [
    "1 ❌ と一緒に G-41 を指しているが、G-41 は済み",
  ]);
});

test("残っている穴・済と書いた所・別のセルは落とさない", () => {
  assert.deepEqual(stale("❌ 上限が無い(穴 G-62)"), []);
  assert.deepEqual(stale("✅ 回る(穴 G-01 は済み)"), []);
  assert.deepEqual(stale("| ❌ 穴 | 番号(G-01 など)で並べた |"), []);
  assert.deepEqual(stale("| 項目 | ✅ G-41(足す前は ❌) |"), []);
  assert.deepEqual(stale("G-01 で足した"), []);
});

test("台本の「足す前の判定」と、その下の字下げした行は見ない", () => {
  const text = [
    "- 判定: ✅ 回る",
    "- 足す前の判定: ❌ 無い(穴 G-41)",
    "  - ❌ 版のタグが無い(G-41)",
    "",
    "- ❌ 今も無い(G-41)",
  ].join("\n");
  assert.deepEqual(stale(text, { scenario: true }), [
    "5 ❌ と一緒に G-41 を指しているが、G-41 は済み",
  ]);
  assert.equal(stale(text).length, 2); // 台本でなければ字下げした行も見る(「足す前」と書いた行は見ない)
});

test("読むファイル", () => {
  assert.equal(shouldScan("README.md"), true);
  assert.equal(shouldScan("docs/legal/order-form.md"), true);
  assert.equal(shouldScan("docs/checkup/todo.yaml"), true);
  assert.equal(shouldScan("docs/specs/0001-tasks.md"), false);
  assert.equal(shouldScan("docs/designs/0001-tasks.md"), false);
  assert.equal(shouldScan("docs/adr/0001-x.md"), false);
  assert.equal(shouldScan("docs/scenarios/gaps.md"), false);
  assert.equal(shouldScan("apps/web/README.md"), false);
  assert.equal(isScenario("docs/scenarios/12-kit-updates.md"), true);
  assert.equal(isScenario("docs/guides/labels.md"), false);
});

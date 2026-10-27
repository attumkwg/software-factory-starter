// pnpm acceptance の中身(acceptance-lib.mjs)のテスト。node --test scripts/acceptance.test.mjs
// 最後のテストはリポジトリの今の記録を読む(CI の test:scripts で、書き方の崩れた記録を止める)。
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  percent,
  readAcceptance,
  readRepoAcceptance,
  readResolved,
  resolvedIdsIn,
  scoreOf,
} from "./acceptance-lib.mjs";

const HEAD =
  "| # | 観点 | 見る人 | 項目 | 結果 | 外れた理由 | 書き戻し先 |\n|---|---|---|---|---|---|---|";
const file = (...lines) => ({ path: "docs/acceptance/0001-a.md", text: lines.join("\n") });
const row = (n, view, who, result, reason = "", backTo = "") =>
  `| ${n} | ${view} | ${who} | 項目${n} | ${result} | ${reason} | ${backTo} |`;
const read = (files, ids = ["R-1"]) => readAcceptance(files, new Set(ids));

test("回と項目を読み、点数を PdM・AI と QA・全体に分ける", () => {
  const { rounds, problems } = read([
    file(
      "## 第1回 2026-10-28",
      HEAD,
      row(1, "流れ", "PdM", "合"),
      row(2, "ルール", "PdM", "否", "要求", "R-1"),
      row(3, "状態", "AI", "合"),
      row(4, "境界値", "QA", "否", "設計", "designs/0001 の 13"),
      row(5, "スマホ", "QA", "未"),
    ),
  ]);
  assert.deepEqual(problems, []);
  assert.equal(rounds.length, 1);
  const s = scoreOf(rounds[0]);
  assert.equal(s.pdm, 0.5);
  assert.equal(s.sweep, 0.5);
  assert.equal(s.all, 0.5);
  assert.equal(s.items, 5);
  assert.equal(s.pdmItems, 2);
  assert.deepEqual(s.reasons, { 要求: 1, 設計: 1, "AI の仮決め": 0, 実装: 0 });
});

test("全部が 未 なら点数は —(0% にしない)", () => {
  const { rounds } = read([file("## 第1回 2026-10-28", HEAD, row(1, "流れ", "PdM", "未"))]);
  assert.equal(percent(scoreOf(rounds[0]).all), "—");
  assert.equal(percent(2 / 3), "67%");
});

test("網羅の観点を PdM に回すと知らせる(観点はおすすめ。落とさない)", () => {
  const { problems, notices } = read([
    file("## 第1回 2026-10-28", HEAD, row(1, "権限", "PdM", "合")),
  ]);
  assert.deepEqual(problems, []);
  assert.match(notices[0], /:4 観点「権限」は網羅の確かめ。PdM に回すと/);
});

test("PdM のおすすめの観点を AI に回すと知らせる・おすすめに無い言葉も知らせる", () => {
  const { problems, notices } = read([
    file(
      "## 第1回 2026-10-28",
      HEAD,
      row(1, "仮決め", "AI", "合"),
      row(2, "大事なお客さんの画面", "PdM", "合"),
    ),
  ]);
  assert.deepEqual(problems, []);
  assert.match(notices[0], /観点「仮決め」は PdM に回すのがおすすめ/);
  assert.match(notices[1], /観点「大事なお客さんの画面」はおすすめの言葉にない/);
});

test("否 の理由は4つのどれか・要求なら論点の番号が要る", () => {
  const { problems } = read([
    file(
      "## 第1回 2026-10-28",
      HEAD,
      row(1, "流れ", "PdM", "否", "なんとなく"),
      row(2, "流れ", "PdM", "否", "要求", ""),
      row(3, "流れ", "PdM", "否", "要求", "R-9"),
      row(4, "流れ", "PdM", "合", "設計"),
    ),
  ]);
  assert.equal(problems.length, 4);
  assert.match(problems[0], /要求 \/ 設計 \/ AI の仮決め \/ 実装/);
  assert.match(problems[1], /書き戻した論点\(R-n\)が無い/);
  assert.match(problems[2], /論点 R-9 が解決済みの論点に無い/);
  assert.match(problems[3], /合・未 の項目に外れた理由を書かない/);
});

test("知らない言葉・空の回・日付の崩れ・前に戻る日付", () => {
  const { problems } = read([
    file(
      "## 第1回 2026-10-28",
      HEAD,
      row(1, "なにか", "PM", "まる"),
      "## 第2回 2026-10-27",
      "## 第3回 きのう",
    ),
  ]);
  assert.ok(!problems.some((p) => p.includes("観点「なにか」")));
  assert.ok(problems.some((p) => p.includes("見る人「PM」")));
  assert.ok(problems.some((p) => p.includes("結果「まる」")));
  assert.ok(problems.some((p) => p.includes(":5 前の回より前の日付")));
  assert.ok(problems.some((p) => p.includes(":6 回の見出しの日付が YYYY-MM-DD でない")));
  assert.ok(problems.some((p) => p.includes(":5 項目が1つも無い")));
});

test("回の見出しより前の表(記録の頭の表)は項目として読まない", () => {
  const { rounds, problems } = read([
    file("| 1 | 何か | 表 |", "## 第1回 2026-10-28", HEAD, row(1, "流れ", "PdM", "合")),
  ]);
  assert.deepEqual(problems, []);
  assert.equal(rounds[0].items.length, 1);
});

test("解決済みの論点の番号を読み、重なりを見つける", () => {
  const text = "| 番号 | 論点 |\n|---|---|\n| R-1 | a |\n| R-2 | b |\n| R-2 | c |\n| 例 | d |";
  const { ids, problems } = readResolved(text);
  assert.deepEqual([...ids], ["R-1", "R-2"]);
  assert.match(problems[0], /resolved-questions.md:5 論点の番号 R-2 が重なっている/);
  assert.deepEqual(resolvedIdsIn("R-1・R-12 と BR- と R-"), ["R-1", "R-12"]);
});

test("今の記録(docs/acceptance と解決済みの論点)に書き方の問題が無い", () => {
  const { problems } = readRepoAcceptance();
  assert.deepEqual(problems, []);
});

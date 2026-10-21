// pnpm bets の中身(bets-lib.mjs)のテスト。node --test scripts/bets.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkBet, checkPrBody, idOfFile, parseBet, proposalOf } from "./bets-lib.mjs";

const TODAY = "2026-10-21";

// 賭けのファイルを組み立てる。lines・pebbles・ledger は表の行(| … |)の配列
const betText = ({ stage, lines = [], pebbles = [], ledger = [], swap = false }) => {
  const lineSection = [
    "## 線と期限(確かめる前に書く)",
    "| 段階 | 確かめること | 合格の線 | 撤退の線 | 期限 | 決めた日 |",
    "|---|---|---|---|---|---|",
    ...lines,
  ];
  const pebbleSection = [
    "## 小石(判断の記録)",
    "| 日付 | 段階 | 何をした | 結果 | 判断 | 証拠 |",
    "|---|---|---|---|---|---|",
    "| 2026-07-01 | idea | 開いた | — | 開く | — |",
    ...pebbles,
  ];
  return [
    "# 賭け: B-0009 テスト",
    "## いまの状態",
    `- 段階: ${stage}`,
    "- 親: 仮説1",
    ...(swap ? [...pebbleSection, ...lineSection] : [...lineSection, ...pebbleSection]),
    "## 会計区分の判定(案。確定は人)",
    "| 日付 | 段階 | 区分の案 | 理由 | 確定した人 |",
    "|---|---|---|---|---|",
    "| 2026-07-01 | idea | 費用 | 探索 | 未確定 |",
    ...ledger,
  ].join("\n");
};

const check = (spec) => checkBet(parseBet(betText(spec)), TODAY);
const CPF_LINE = "| cpf | 困りごと | 3/5 | 1/5 | 2026-08-01 | 2026-07-02 |";
const CPF_LEDGER = "| 2026-07-02 | cpf | 費用 | 探索 | 未確定 |";
const TO_CPF = "| 2026-07-02 | idea | 線を決めた | — | 進む | — |";

test("見本の賭け(B-0001)は通る", () => {
  const text = readFileSync("docs/product/bets/B-0001-task-completed-mail.md", "utf8");
  const result = checkBet(parseBet(text), TODAY);
  assert.deepEqual(result.problems, []);
  assert.equal(result.due, undefined);
});

test("線と期限を決める前の結果は落ちる", () => {
  const result = check({
    stage: "psf",
    lines: ["| cpf | 困りごと | 3/5 | 1/5 | 2026-08-01 | 2026-07-20 |"],
    pebbles: [TO_CPF, "| 2026-07-10 | cpf | 話を聞いた | 4/5 | 進む | — |"],
    ledger: [CPF_LEDGER, "| 2026-07-10 | psf | 費用 | 探索 | 未確定 |"],
  });
  assert.match(result.problems.join("\n"), /より前に決まっていない/);
});

test("「線と期限」が「小石」より後ろにあると落ちる", () => {
  const result = check({ stage: "idea", swap: true });
  assert.match(result.problems.join("\n"), /小石」より前に書く/);
});

test("段階を黙って飛ばすと落ちる・「飛ばす」の小石があれば通る", () => {
  const skipped = check({
    stage: "psf",
    pebbles: [TO_CPF],
    ledger: [CPF_LEDGER, "| 2026-07-03 | psf | 費用 | 探索 | 未確定 |"],
  });
  assert.match(skipped.problems.join("\n"), /小石をたどった段階「cpf」と合わない/);
  const ok = check({
    stage: "psf",
    pebbles: [TO_CPF, "| 2026-07-03 | cpf | 確かめない | 計画で確かめ済み | 飛ばす | — |"],
    ledger: [CPF_LEDGER, "| 2026-07-03 | psf | 費用 | 探索 | 未確定 |"],
  });
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.noLine, true);
});

test("線が2行あるのに「線を動かす(@名前)」が無いと落ちる", () => {
  const twoLines = [CPF_LINE, "| cpf | 困りごと | 2/5 | 0/5 | 2026-09-01 | 2026-07-20 |"];
  const base = { stage: "cpf", lines: twoLines, ledger: [CPF_LEDGER] };
  const silent = check({ ...base, pebbles: [TO_CPF] });
  assert.match(silent.problems.join("\n"), /線を動かす\(@名前\)」の小石が足りない/);
  const noName = check({
    ...base,
    pebbles: [TO_CPF, "| 2026-07-20 | cpf | 見直した | — | 線を動かす | — |"],
  });
  assert.match(noName.problems.join("\n"), /名前を残す/);
  const ok = check({
    ...base,
    pebbles: [TO_CPF, "| 2026-07-20 | cpf | 見直した | — | 線を動かす(@a: 甘くした) | — |"],
  });
  assert.deepEqual(ok.problems, []);
});

test("入った段階の会計区分の行が無いと落ちる・区分の案は3つのどれか", () => {
  const missing = check({ stage: "cpf", lines: [CPF_LINE], pebbles: [TO_CPF] });
  assert.match(missing.problems.join("\n"), /段階 cpf の会計区分/);
  const wrong = check({
    stage: "cpf",
    lines: [CPF_LINE],
    pebbles: [TO_CPF],
    ledger: ["| 2026-07-02 | cpf | 研究費 | 探索 | 未確定 |"],
  });
  assert.match(wrong.problems.join("\n"), /区分の案は/);
});

test("期限を過ぎて決めていない賭けは一覧に出すが、落とさない", () => {
  const result = check({
    stage: "cpf",
    lines: [CPF_LINE],
    pebbles: [TO_CPF],
    ledger: [CPF_LEDGER],
  });
  assert.deepEqual(result.problems, []);
  assert.equal(result.due, "2026-08-01");
});

test("小石の日付が戻ると落ちる・やめた後は進めない", () => {
  const older = check({ stage: "cpf", pebbles: ["| 2026-06-01 | idea | — | — | 進む | — |"] });
  assert.match(older.problems.join("\n"), /古い/);
  const dropped = check({
    stage: "cpf",
    pebbles: [
      "| 2026-07-02 | idea | — | — | やめる | — |",
      "| 2026-07-03 | dropped | — | — | 進む | — |",
    ],
  });
  assert.match(dropped.problems.join("\n"), /段階 dropped では「進む」はできない/);
});

test("ファイル名から ID を取る", () => {
  assert.equal(idOfFile("B-0001-task-mail.md"), "B-0001");
  assert.equal(idOfFile("B-1-x.md"), undefined);
  assert.equal(idOfFile("B-0001.md"), undefined);
});

test("PR の本文: 空・説明の中の例だけ・知らない賭けは落ちる", () => {
  const bets = { "B-0001": "rollout", "B-0002": "dropped", "B-0003": "cpf" };
  assert.ok(checkPrBody("", { bets }).problems.length > 0);
  const onlyComment =
    "<!--\n- 取り組み: bet:B-0001\n- 作業の種類: 探索\n-->\n- 取り組み:\n- 作業の種類:";
  assert.ok(checkPrBody(onlyComment, { bets }).problems.length > 0);
  const unknown = checkPrBody("- 取り組み: bet:B-0404\n- 作業の種類: 探索", { bets });
  assert.match(unknown.problems.join("\n"), /B-0404 のファイル/);
  const ended = checkPrBody("- 取り組み: bet:B-0002\n- 作業の種類: 作り込み", { bets });
  assert.match(ended.problems.join("\n"), /撤去」だけ/);
});

test("PR の本文: 通るときは会計区分の案を返す", () => {
  const bets = { "B-0001": "rollout", "B-0003": "cpf" };
  const build = checkPrBody("- 取り組み: `bet:B-0001`\n- 作業の種類: 作り込み", { bets });
  assert.deepEqual(build.problems, []);
  assert.equal(build.proposal, "資産の候補");
  const early = checkPrBody("- 取り組み: bet:B-0003\n- 作業の種類: 作り込み", { bets });
  assert.equal(early.proposal, "費用");
  assert.equal(early.notes.length, 1);
  const noted = checkPrBody("- 取り組み: 保守(依存の更新)\n- 作業の種類: 保守(軽い直し)", { bets });
  assert.deepEqual(noted.problems, []);
  assert.equal(noted.kind, "保守");
  const bot = checkPrBody("", { author: "renovate[bot]", bets });
  assert.deepEqual(bot.problems, []);
  assert.equal(bot.proposal, "費用");
});

test("会計区分の案の表", () => {
  assert.equal(proposalOf("psf", "作り込み"), "費用");
  assert.equal(proposalOf("adopted", "作り込み"), "資産の候補");
  assert.equal(proposalOf("adopted", "保守"), "費用");
  assert.equal(proposalOf("rollout", "探索"), "費用");
  assert.match(proposalOf("retired", "撤去"), /^除却の候補/);
  assert.match(proposalOf(undefined, "作り込み"), /人が決める/);
});

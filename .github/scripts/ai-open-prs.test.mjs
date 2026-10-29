import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { prQuestions, QUEUE_LABELS } from "../../scripts/human-queue-lib.mjs";
import { sensorsOnlyFrom } from "../../scripts/pr-merge-lib.mjs";
import {
  hasQuestions,
  isBackgroundAiPr,
  judgeOpenPrs,
  limitOf,
  sensorsOnlyOf,
  WAITING_LABELS,
} from "./ai-open-prs-lib.mjs";

const pr = (number, login, type = "User", labels = []) => ({
  number,
  user: { login, type },
  labels: labels.map((name) => ({ name })),
});

test("背景の AI の PR は、Claude のアプリが作った物だけ", () => {
  assert.equal(isBackgroundAiPr(pr(1, "claude[bot]", "Bot")), true);
  // 手元の AI の PR(人のアカウントで作る。ai:assisted が付く)は数えない
  assert.equal(isBackgroundAiPr(pr(2, "suzuki", "User", ["ai:assisted"])), false);
  assert.equal(isBackgroundAiPr(pr(3, "renovate[bot]", "Bot")), false);
  // ボットの名前を名乗る人のアカウントは数えない
  assert.equal(isBackgroundAiPr(pr(4, "claude-fan", "User")), false);
  assert.equal(isBackgroundAiPr({ number: 5, user: null }), false);
});

test("上限の数の読み方(数でなければ既定の 5)", () => {
  assert.equal(limitOf("3"), 3);
  assert.equal(limitOf(" 10 "), 10);
  assert.equal(limitOf(""), 5);
  assert.equal(limitOf("0"), 5);
  assert.equal(limitOf("abc"), 5);
  assert.equal(limitOf(undefined), 5);
});

test("上限より少なければ動き、達したら動かない", () => {
  const bots = [1, 2, 3].map((n) => pr(n, "claude[bot]", "Bot"));
  const others = [pr(9, "suzuki", "User", ["ai:assisted"]), pr(10, "renovate[bot]", "Bot")];
  const under = judgeOpenPrs({ prs: [...bots, ...others], limit: 4 });
  assert.equal(under.ok, true);
  assert.ok(under.line.includes("3 / 4 本"));
  const full = judgeOpenPrs({ prs: [...bots, ...others], limit: 3 });
  assert.equal(full.ok, false);
  assert.ok(full.line.includes("#1・#2・#3"));
  assert.equal(judgeOpenPrs({ prs: [], limit: 5 }).ok, true);
});

const QUESTION_BODY = [
  "## 🧑‍⚖️ 人に判断してほしい所",
  "",
  "| # | 種類 | 事実 | 人が判断する問い |",
  "|---|---|---|---|",
  "| 1 | 事業判断 | 既定はオフ | (a) オフのまま か (b) オン か |",
].join("\n");

test("センサーだけで入れる所では、人を待つ PR(印・問い)だけを上限に数える(仕様 0095)", () => {
  const bot = (n, labels = [], body = "") => ({ ...pr(n, "claude[bot]", "Bot", labels), body });
  const prs = [
    bot(1),
    bot(2),
    bot(3, ["risk:high"]),
    bot(4, [], QUESTION_BODY),
    bot(5, ["needs-human"]),
  ];
  // 返事を待つ所(今までどおり): 全部を数える
  assert.equal(judgeOpenPrs({ prs, limit: 5 }).ok, false);
  // センサーだけで入れる所: 人を待つのは 3・4・5 の3本
  const sensors = judgeOpenPrs({ prs, limit: 5, sensorsOnly: true });
  assert.equal(sensors.ok, true);
  assert.ok(sensors.line.includes("3 / 5 本"), sensors.line);
  const full = judgeOpenPrs({ prs, limit: 3, sensorsOnly: true });
  assert.equal(full.ok, false);
  assert.ok(full.line.includes("#3・#4・#5"), full.line);
});

test("全部の本数にも天井(センサーで回る PR も CI と費用に効く)", () => {
  const prs = Array.from({ length: 4 }, (_, i) => ({
    ...pr(i + 1, "claude[bot]", "Bot"),
    body: "",
  }));
  const r = judgeOpenPrs({ prs, limit: 5, totalLimit: 4, sensorsOnly: true });
  assert.equal(r.ok, false);
  assert.ok(r.line.includes("全体の上限(4 本)"), r.line);
  assert.equal(limitOf("", 20), 20);
});

test("見分けは、判断待ちの積み場・マージの判定と同じ(写しがずれていない)", () => {
  assert.deepEqual(WAITING_LABELS, QUEUE_LABELS);
  const bodies = [
    QUESTION_BODY,
    "## 🧑‍⚖️ 人に判断してほしい所\n\n| # | 問い |\n|---|---|\n| 1 | なし |",
    "## 🧑‍⚖️ 人に判断してほしい所\n<!-- | 1 | 例 | 例 | 例の問い | -->\n| | | | |",
    "## 🧑‍⚖️ 人に判断してほしい所\n\n| 1 | 問い |\n\n## 次\n| 2 | 外の表 |",
    "本文なし",
  ];
  for (const b of bodies) assert.equal(hasQuestions(b), prQuestions(b).length > 0, b);
  const setup = readFileSync(".github/setup.yml", "utf8");
  for (const y of [setup, "ai_merge:\n  sensors_only: true\n", "x:\n  sensors_only: true\n"])
    assert.equal(sensorsOnlyOf(y), sensorsOnlyFrom(y), y);
});

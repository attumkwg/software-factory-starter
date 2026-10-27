import assert from "node:assert/strict";
import { test } from "node:test";
import { isBackgroundAiPr, judgeOpenPrs, limitOf } from "./ai-open-prs-lib.mjs";

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

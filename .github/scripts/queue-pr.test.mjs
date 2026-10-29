import assert from "node:assert/strict";
import { test } from "node:test";
import { prNumberFromQueueRef, prNumberOf } from "./queue-pr-lib.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";

test("キューの枝の名前から PR の番号を引く", () => {
  assert.equal(prNumberFromQueueRef(`refs/heads/gh-readonly-queue/main/pr-123-${SHA}`), 123);
  assert.equal(prNumberFromQueueRef(`gh-readonly-queue/main/pr-7-${SHA}`), 7);
  // 土台の枝の名前に / があっても読む
  assert.equal(prNumberFromQueueRef(`gh-readonly-queue/release/v1/pr-45-${SHA}`), 45);
});

test("キューの枝でない名前は読まない(黙って通さない)", () => {
  assert.equal(prNumberFromQueueRef("refs/heads/main"), undefined);
  assert.equal(prNumberFromQueueRef(`refs/heads/feature/pr-123-${SHA}`), undefined);
  assert.equal(prNumberFromQueueRef("gh-readonly-queue/main/pr-x-abc"), undefined);
  assert.equal(prNumberFromQueueRef(""), undefined);
  assert.equal(prNumberFromQueueRef(undefined), undefined);
});

test("pull_request の番号が先。無ければキューの枝から", () => {
  assert.equal(prNumberOf({ prNumber: "9", queueRef: `gh-readonly-queue/main/pr-1-${SHA}` }), 9);
  assert.equal(prNumberOf({ prNumber: "", queueRef: `gh-readonly-queue/main/pr-1-${SHA}` }), 1);
  assert.equal(prNumberOf({ prNumber: "0", queueRef: "" }), undefined);
});

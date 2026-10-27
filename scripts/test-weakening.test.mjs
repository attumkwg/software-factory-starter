import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findWeakening,
  isCoverageConfig,
  isTestFile,
  patchLines,
  summarize,
} from "./test-weakening-lib.mjs";

const patch = (...lines) => ["@@ -1,3 +1,3 @@", ...lines].join("\n");
const kinds = (files) => findWeakening(files).map((x) => `${x.kind}:${x.file}`);

test("テストのファイルとカバレッジの設定を見分ける", () => {
  assert.equal(isTestFile("apps/api/test/unit/tasks.test.ts"), true);
  assert.equal(isTestFile("apps/web/e2e/login.spec.ts"), true);
  assert.equal(isTestFile("scripts/bets.test.mjs"), true);
  assert.equal(isTestFile("apps/api/src/tasks/routes.ts"), false);
  assert.equal(isCoverageConfig("packages/shared/vitest.config.ts"), true);
  assert.equal(isCoverageConfig("apps/web/playwright.config.ts"), false);
});

test("差分の足した行・消した行(ファイルの頭は数えない)", () => {
  const { added, removed } = patchLines("--- a/x\n+++ b/x\n@@\n-old\n+new\n same");
  assert.deepEqual(added, ["new"]);
  assert.deepEqual(removed, ["old"]);
});

test("テストを消した・テストでない名前にした", () => {
  assert.deepEqual(kinds([{ filename: "a/x.test.ts", status: "removed" }]), [
    "消したテスト:a/x.test.ts",
  ]);
  assert.deepEqual(
    kinds([{ filename: "a/x.ts", previous_filename: "a/x.test.ts", status: "renamed", patch: "" }]),
    ["消したテスト:a/x.ts"],
  );
});

test("skip・only・todo などを足した(消した分と差し引く)", () => {
  const f = (p) => [{ filename: "a/x.test.ts", status: "modified", patch: p }];
  assert.deepEqual(kinds(f(patch('-  it("a", () => {', '+  it.skip("a", () => {'))), [
    "飛ばす書き方:a/x.test.ts",
  ]);
  assert.deepEqual(kinds(f(patch("+test .only('a', () => {})"))), ["飛ばす書き方:a/x.test.ts"]);
  assert.deepEqual(kinds(f(patch("+  xit('a', () => {})"))), ["飛ばす書き方:a/x.test.ts"]);
  // skip を外して別の所に付け直しただけなら増えていない
  assert.deepEqual(kinds(f(patch("-it.skip('a')", "+it.skip('b')"))), []);
  // テストでないファイルの .skip( は見ない
  assert.deepEqual(
    kinds([{ filename: "a/x.ts", status: "modified", patch: patch("+list.skip(1)") }]),
    [],
  );
});

test("確かめ(expect・assert)が減った", () => {
  const f = (p) => [{ filename: "a/x.test.ts", status: "modified", patch: p }];
  assert.deepEqual(
    kinds(f(patch("-  expect(a).toBe(1);", "-  expect(b).toBe(2);", "+  expect(a).toBe(1);"))),
    ["確かめが減った:a/x.test.ts"],
  );
  assert.deepEqual(kinds(f(patch("-  assert.equal(a, 1);"))), ["確かめが減った:a/x.test.ts"]);
  // 書き換えただけ(数が同じ)なら印を付けない
  assert.deepEqual(kinds(f(patch("-  expect(a).toBe(1);", "+  expect(a).toBe(2);"))), []);
});

test("カバレッジの下限を下げた・外した", () => {
  const f = (p) => [{ filename: "apps/api/vitest.config.ts", status: "modified", patch: p }];
  const found = findWeakening(
    f(patch("-        lines: 80,", "+        lines: 75,", "-        branches: 70,")),
  );
  assert.deepEqual(
    found.map((x) => x.detail),
    ["lines の下限を 80 → 75 にした", "branches の下限(70)を外した"],
  );
  // 上げたのは印を付けない
  assert.deepEqual(kinds(f(patch("-        lines: 75,", "+        lines: 80,"))), []);
});

test("検査を黙らせる注釈を足した(どのファイルでも)", () => {
  const f = [
    {
      filename: "apps/api/src/x.ts",
      status: "modified",
      patch: patch("+// biome-ignore lint/x: y", "+// @ts-expect-error"),
    },
  ];
  assert.deepEqual(
    findWeakening(f).map((x) => x.detail),
    ["biome-ignore が 1 個増えた", "@ts-expect-error が 1 個増えた"],
  );
});

test("差分が読めないテスト・設定は人に回す。ふつうの変更は印を付けない", () => {
  assert.deepEqual(kinds([{ filename: "a/x.test.ts", status: "modified" }]), [
    "読めない差分:a/x.test.ts",
  ]);
  assert.deepEqual(
    kinds([
      {
        filename: "a/x.test.ts",
        status: "added",
        patch: patch("+it('a', () => { expect(1).toBe(1) })"),
      },
    ]),
    [],
  );
  assert.deepEqual(summarize([]), ["✅ テストと検査を弱めた所は見つからない"]);
  assert.equal(summarize([{ file: "a", kind: "k", detail: "d" }]).length, 2);
});

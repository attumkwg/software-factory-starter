// pnpm verify:lint の中身(verify-lint-lib.mjs)のテスト。node --test scripts/verify-lint.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { lintVerify } from "./verify-lint-lib.mjs";

const IMPORT = 'import { expect, test } from "../verify-fixture";';
const spec = (...body) => [IMPORT, 'test("確認", async ({ page }) => {', ...body, "});"].join("\n");
const rules = (text) => lintVerify(text).map((p) => p.rule);

// 前を確かめ → 操作 → 後を中身で確かめる、良い形
const GOOD = [
  'await page.goto("/projects");',
  'await expect(page.getByRole("row", { name: "見積もり" })).toHaveCount(0);',
  'await page.getByRole("button", { name: "タスクを足す" }).click();',
  'await page.getByLabel("題名").fill("見積もり");',
  'await page.getByRole("button", { name: "保存" }).click();',
  'await expect(page.getByRole("row", { name: "見積もり" })).toHaveCount(1);',
];

test("前・操作・後を中身で確かめる形は通る(URL の // は注釈にしない)", () => {
  assert.deepEqual(
    lintVerify(spec(...GOOD, 'await expect(page).toHaveURL("http://localhost:8080/projects");')),
    [],
  );
});

test("verify-fixture を使わないと記録が取れない", () => {
  const text = spec(...GOOD).replace("../verify-fixture", "@playwright/test");
  assert.deepEqual(rules(text), ["記録が取れない"]);
});

test("アサーションが無い・最後の操作の後に無い", () => {
  assert.deepEqual(
    rules(spec('await page.goto("/");', 'await page.getByRole("button").click();')),
    ["アサーション無し"],
  );
  assert.deepEqual(rules(spec(...GOOD.slice(0, 5))), ["アサーション無し"]);
});

test("操作の前に何も確かめていない(前から合格を見逃す)", () => {
  assert.deepEqual(rules(spec(...GOOD.filter((_, i) => i !== 1))), ["操作の前から合格"]);
});

test("見えるかだけの確かめはうわべ", () => {
  const text = spec(
    'await expect(page.getByText("保存")).toBeVisible();',
    'await page.getByRole("button", { name: "保存" }).click();',
    'await expect(page.getByText("保存しました")).toBeVisible();',
  );
  assert.deepEqual(rules(text), ["うわべの確認"]);
});

test("エラーの放置(握りつぶし・try)", () => {
  assert.deepEqual(rules(spec(...GOOD, 'await page.getByText("x").click().catch(() => {});')), [
    "アサーション無し",
    "エラーの放置",
  ]);
  assert.ok(rules(spec(...GOOD, "try {", "} catch {}")).includes("エラーの放置"));
});

test("API の直叩きは止める。準備の印があれば通す(確かめを混ぜなければ)", () => {
  assert.deepEqual(rules(spec('await page.request.post("/api/tasks");', ...GOOD)), [
    "API の直叩き",
  ]);
  assert.deepEqual(
    rules(spec('await page.request.post("/api/tasks"); // 準備: 種データに無い組織', ...GOOD)),
    [],
  );
  assert.deepEqual(
    rules(spec("// 準備: タスクを10件", 'await request.post("/api/tasks");', ...GOOD)),
    [],
  );
  assert.deepEqual(
    rules(
      spec('expect((await page.request.get("/api/tasks")).ok()).toBe(true); // 準備: x', ...GOOD),
    ),
    ["API の直叩き"],
  );
});

test("判定のすり替え・不適切な操作・時間で待つ・飛ばす", () => {
  const got = rules(
    [
      IMPORT,
      'test.only("確認", async ({ page }) => {',
      'await page.route("**/api/**", (r) => r.fulfill({ status: 200 }));',
      "await page.evaluate(() => document.title);",
      "expect(true).toBe(true);",
      'await expect.soft(page.getByText("a")).toHaveText("a");',
      'await page.getByRole("button").click({ force: true });',
      "await page.waitForTimeout(1000);",
      'await expect(page.getByText("a")).toHaveText("b");',
      "});",
    ].join("\n"),
  );
  assert.deepEqual(got, [
    "確認を飛ばす",
    "判定のすり替え",
    "判定のすり替え",
    "判定のすり替え",
    "判定のすり替え",
    "不適切な操作",
    "非同期の偽陽性",
  ]);
});

test("注釈の中の言葉では止めない・test.step は別の確認に数えない", () => {
  const text = spec(
    "// page.request は使わない。waitForTimeout も使わない",
    'await test.step("前", async () => {',
    ...GOOD,
    "});",
  );
  assert.deepEqual(lintVerify(text), []);
});

import { expect, test } from "@playwright/test";
import { expectAccessible, loginAs } from "./helpers.ts";

// スマホの幅(320px)で、主な流れ(task-flow・audit)が通らない画面も横にはみ出さないか(expectAccessible)。
// 表・選択・入力・長い本文がある画面を、見るだけで回る(書き込まない。ほかの E2E と並んで流れても食い違わない)。
// パソコンの幅では、それぞれの画面の E2E がすでに見ている。

test.skip(({ isMobile }) => !isMobile, "スマホの組だけ(playwright.config.ts の MOBILE_SPECS)");

test("ログイン無しで読める規約の本文(長い箇条・変更の履歴)", async ({ page }) => {
  await page.goto("/legal/terms");
  await expect(page.getByRole("heading", { name: "利用規約", level: 1 })).toBeVisible();
  await expectAccessible(page);
  await page.goto("/legal/privacy/1");
  await expect(page.getByRole("heading", { name: "プライバシーポリシー", level: 1 })).toBeVisible();
  await expectAccessible(page);
});

test("管理者の設定とサポートへの許可(表と選択)", async ({ page }) => {
  await loginAs(page, "admin@acme.test");
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "設定", level: 1 })).toBeVisible();
  await expectAccessible(page);
  await page.goto("/support-access");
  await expect(page.getByRole("heading", { name: "サポートへの許可", level: 1 })).toBeVisible();
  await expectAccessible(page);
  await page.goto("/invitations");
  await expect(page.getByRole("heading", { name: "招待", level: 1 })).toBeVisible();
  await expectAccessible(page);
  await page.goto("/members");
  await expect(page.getByRole("heading", { name: "組織の人", level: 1 })).toBeVisible();
  await expectAccessible(page);
});

test("招待を受ける画面(ログイン無し・名前の入力)", async ({ page }) => {
  await page.goto("/invitation");
  await expect(page.getByRole("heading", { name: "招待を受ける", level: 1 })).toBeVisible();
  await expectAccessible(page);
});

test("運営のサポートの入口(番号の入力)", async ({ page }) => {
  await loginAs(page, "support@ops.test");
  await page.goto("/support");
  await expect(page.getByRole("heading", { name: "サポート", level: 1 })).toBeVisible();
  await expectAccessible(page);
});

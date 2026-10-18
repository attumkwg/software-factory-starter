import { expect, test } from "@playwright/test";
import { expectAccessible, loginAs } from "./helpers.ts";

// サポートの代理ログイン(docs/specs/0004-support-access.md)。
// お客さん(Acme の管理者)が許可 → 社員(運営)が番号で入る → 見るだけ → 終わる → お客さんの監査ログに残る。

test("お客さんが許可した間だけ、社員が見るだけで入れて、記録が残る", async ({ browser }) => {
  const customer = await (await browser.newContext()).newPage();
  await loginAs(customer, "admin@acme.test");
  await customer.getByRole("link", { name: "設定" }).click();
  await customer.getByRole("link", { name: "サポートへの許可を開く" }).click();
  await expect(customer.getByRole("heading", { name: "サポートへの許可" })).toBeVisible();
  await customer.getByRole("button", { name: "許可する", exact: true }).click();
  const code = (await customer.getByTestId("support-code").textContent()) ?? "";
  expect(code).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
  await expectAccessible(customer);

  const staff = await (await browser.newContext()).newPage();
  await loginAs(staff, "support@ops.test");
  await staff.getByRole("link", { name: "サポート", exact: true }).click();
  await staff.getByLabel("サポート番号").fill(code);
  await staff.getByRole("button", { name: "入る" }).click();
  await expect(staff.getByTestId("support-banner")).toContainText("Acme");
  await expect(staff.getByRole("link", { name: "Acme の立ち上げ" })).toBeVisible();
  // 見るだけ: 作るボタンが無い
  await expect(staff.getByRole("button", { name: "作る" })).toHaveCount(0);
  await expectAccessible(staff);
  await staff.getByRole("button", { name: "終わる" }).click();
  await expect(staff.getByRole("heading", { name: "サポート" })).toBeVisible();
  await expect(staff.getByTestId("support-banner")).toHaveCount(0);

  await customer.goto("/audit");
  const table = customer.getByRole("grid", { name: "監査ログ" });
  for (const text of ["サポートが入った", "サポートが見た", "サポートが出た"]) {
    await expect(table.getByRole("row").filter({ hasText: text }).first()).toBeVisible();
  }
});

test("運営でない人には「サポート」の入口が出ない", async ({ page }) => {
  await loginAs(page, "member@acme.test");
  await expect(page.getByRole("link", { name: "サポート", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "設定" })).toHaveCount(0);
});

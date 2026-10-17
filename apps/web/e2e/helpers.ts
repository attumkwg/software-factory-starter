import { expect, type Page } from "@playwright/test";

// 種データ(apps/api/src/db/seed.ts)の利用者でログインする
export async function loginAs(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: "プロジェクト" })).toBeVisible();
}

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * アクセシビリティの自動検査(axe)。WCAG 2.1 の A と AA の決まりに反する所が無いこと。
 * 色のコントラスト・名前の無いボタン・ラベルの無い入力などを見つける。
 * 見つからないもの(キーボードだけで最後まで使えるか・読み上げの順番が自然か)は、人が確かめる。
 */
export async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const problems = results.violations.map(
    (v) => `${v.id}: ${v.help}(${v.nodes.map((n) => n.target.join(" ")).join(", ")})`,
  );
  expect(problems, "アクセシビリティの問題").toEqual([]);
}

// 種データ(apps/api/src/db/seed.ts)の利用者でログインする
export async function loginAs(page: Page, email: string) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: "プロジェクト" })).toBeVisible();
  await expectAccessible(page);
}

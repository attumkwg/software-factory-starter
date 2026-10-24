import { expect, test } from "@playwright/test";
import { expectAccessible } from "./helpers.ts";

// 部品の一覧(/design-system)。ログイン無しで開け、axe を通り、横にはみ出さない(パソコンとスマホの組)。
// 本番で 404 になるのは src/design-system.test.ts。見た目は e2e/vrt が撮って比べる

test("部品の一覧に、部品が種類ごとに並ぶ", async ({ page }) => {
  await page.goto("/design-system");
  await expect(page.getByRole("heading", { name: "部品の一覧", level: 1 })).toBeVisible();
  for (const name of [
    "ボタン",
    "リンク",
    "入力",
    "チェック",
    "表",
    "お知らせ",
    "確認のダイアログ",
  ]) {
    await expect(
      page.getByRole("heading", { name: new RegExp(`^${name}`), level: 2 }),
    ).toBeVisible();
  }
  await expectAccessible(page);

  // 確認のダイアログは開いて閉じられる(見本なので何も消えない)
  await page.getByRole("button", { name: "消す" }).click();
  const dialog = page.getByRole("alertdialog", { name: "見本を消しますか?" });
  await expect(dialog).toBeVisible();
  await expectAccessible(page);
  await dialog.getByRole("button", { name: "やめる" }).click();
  await expect(dialog).toBeHidden();
});

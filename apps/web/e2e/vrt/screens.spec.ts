import { expect, type Page, test } from "@playwright/test";
import { loginAs } from "../helpers.ts";
import { SCREENS } from "./screens.ts";

// 主な画面を撮り、基準の画像(__screenshots__/<desktop|mobile>/<id>.png)と比べる。見るだけ(書き込まない)。
// 設定は playwright.vrt.config.ts(ブラウザは Docker の中)。手順は docs/guides/vrt.md

// 日によって変わる文字(作った日など。format.ts の 2026/10/24 の形)は塗る
const DATE = /^\d{4}\/\d{1,2}\/\d{1,2}$/;

async function snap(page: Page, id: string) {
  await expect(page).toHaveScreenshot(`${id}.png`, {
    fullPage: true,
    mask: [page.getByText(DATE)],
    // 塗った所は灰色(既定の桃色は目立ちすぎる)
    maskColor: "#9aa3ad",
  });
}

for (const screen of SCREENS) {
  test(`${screen.label}(${screen.path})`, async ({ page }) => {
    if (screen.as) await loginAs(page, screen.as);
    await page.goto(screen.path);
    await expect(page.getByRole("heading", { name: screen.heading, level: 1 })).toBeVisible();
    await snap(page, screen.id);
  });
}

test("部品の一覧(確認のダイアログ)", async ({ page }) => {
  await page.goto("/design-system");
  await page.getByRole("button", { name: "消す" }).click();
  await expect(page.getByRole("alertdialog", { name: "見本を消しますか?" })).toBeVisible();
  await snap(page, "design-system-dialog");
});

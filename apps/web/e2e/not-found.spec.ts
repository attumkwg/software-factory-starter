import { expect, test } from "@playwright/test";
import { expectAccessible } from "./helpers.ts";

// 無い URL は 404(検索や見張りに「ある」と思わせない)。画面は「見つからない」を出し、検索には載せない。

test("無い URL を開くと 404 で「ページが見つかりません」が出る", async ({ page }) => {
  const res = await page.goto("/no-such");
  expect(res?.status()).toBe(404);
  expect(res?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await expect(page.getByRole("heading", { name: "ページが見つかりません" })).toBeVisible();
  await expectAccessible(page);
});

test("robots.txt は本番以外では全部お断り・favicon は画面のサーバーが返す", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain("Disallow: /\n");
  expect((await request.get("/favicon.svg")).status()).toBe(200);
  expect((await request.get("/favicon.ico")).status()).toBe(404);
});

import { expect, test } from "@playwright/test";

// 画面ごとの title・説明・OGP(リンクを貼ったときのカード)。src/head.ts の pageHead(docs/designs/0010-web-head-ogp.md)。
// 公開の画面は説明と og:url を出す。OGP があっても検索には載せない(決めるのは画面のサーバー)。

test("公開の画面は title・説明・OGP を出し、検索には載せないまま", async ({ page }) => {
  await page.goto("/login");
  await expect(page).toHaveTitle("ログイン | Tasks");
  const meta = (selector: string) => page.locator(`meta[${selector}]`).getAttribute("content");
  expect(await meta('name="description"')).toContain("ログイン");
  expect(await meta('property="og:title"')).toBe("ログイン");
  expect(await meta('property="og:type"')).toBe("website");
  expect(await meta('property="og:description"')).toContain("ログイン");
  // og:url は画面の URL(APP_URL)から。docker compose では http://localhost:8080。
  // プレビュー環境の画面には APP_URL が無いので出ない(出るなら正しい URL であること)
  const ogUrl = await meta('property="og:url"');
  if (process.env.E2E_BASE_URL === undefined) expect(ogUrl).toBe("http://localhost:8080/login");
  else if (ogUrl !== null) expect(ogUrl).toBe(new URL("/login", page.url()).href);
  // 検索に載せるかは決めない(画面のサーバーが全部の応答に X-Robots-Tag: noindex。server/app.test.ts)
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);

  // 規約の本文は文書(article)
  await page.goto("/legal/terms");
  await expect(page).toHaveTitle("利用規約 | Tasks");
  expect(await meta('property="og:type"')).toBe("article");
});

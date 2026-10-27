import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { expectAccessible, loginAs } from "./helpers.ts";

// データの書き出し(docs/specs/0005-offboarding.md)。管理者が設定から JSON を受け取る。

test("管理者は設定から自社のデータを JSON で書き出せる(他社の物は入らない)", async ({
  page,
}, testInfo) => {
  await loginAs(page, "admin@acme.test");
  await page.getByRole("link", { name: "設定" }).click();
  await expect(page.getByRole("heading", { name: "設定" })).toBeVisible();
  await expectAccessible(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "書き出す" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^export-\d{4}-\d{2}-\d{2}\.json$/);
  // CI は Docker の中のブラウザにつなぐので、手元に写してから読む(path() はつないだ先では使えない)
  const saved = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(saved);
  const text = readFileSync(saved, "utf8");
  const data = JSON.parse(text) as { format: string; organization: { name: string } };
  expect(data.format).toBe("software-factory-starter/export@1");
  expect(data.organization.name).toBe("Acme 株式会社");
  expect(text).toContain("Acme の立ち上げ");
  expect(text).not.toContain("Globex");
});

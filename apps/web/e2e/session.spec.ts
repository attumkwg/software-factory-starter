import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers.ts";

// ログインの有効期間(ADR 0017): 使っている間は Cookie の期限が延びる。
// 画面の読み込み(SSR)でも延びること = API が出し直したセッションの Cookie を、画面のサーバーが写していること。
// API は1分に1回しか出し直さないので、1分待ってから開き直す。

const sessionCookie = async (page: import("@playwright/test").Page) =>
  (await page.context().cookies()).find((c) => c.name === "sid" || c.name === "__Host-sid");

test("画面を開き直すだけでも、ログインの期限が延びる", async ({ page }) => {
  test.slow();
  await loginAs(page, "member@acme.test");
  const before = await sessionCookie(page);
  expect(before).toBeDefined();

  await page.waitForTimeout(61_000);
  const res = await page.reload();
  const setCookies = (await res?.headersArray())?.filter(
    (h) => h.name.toLowerCase() === "set-cookie",
  );
  expect(setCookies?.some((h) => /^(__Host-)?sid=/.test(h.value))).toBe(true);
  const after = await sessionCookie(page);
  expect(after?.expires ?? 0).toBeGreaterThan((before?.expires ?? 0) + 50);
  await expect(page.getByRole("heading", { name: "プロジェクト" })).toBeVisible();
});

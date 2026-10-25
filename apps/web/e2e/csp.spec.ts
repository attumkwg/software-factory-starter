import { expect, type Page, test } from "@playwright/test";
import { loginAs } from "./helpers.ts";

// 画面の CSP(Content-Security-Policy。server/app.ts・docs/designs/0045-web-csp.md)。
// 主な画面を開いて操作し、CSP に止められた物(違反)が1つでもあれば落とす。
// あわせて、nonce の無い埋め込みのスクリプトが本当に止まることを確かめる(CSP が飾りでないこと)。

type Violation = { directive: string; blockedURI: string; sample: string };

declare global {
  interface Window {
    __cspViolations?: Violation[];
    __injected?: boolean;
  }
}

// ページの読み込みより前に、違反の知らせを拾う
async function watchCsp(page: Page) {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__cspViolations?.push({
        directive: e.effectiveDirective,
        blockedURI: e.blockedURI,
        sample: e.sample,
      });
    });
  });
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && msg.text().includes("Content Security Policy"))
      consoleErrors.push(msg.text());
  });
  return consoleErrors;
}

async function expectNoViolations(page: Page, consoleErrors: string[], where: string) {
  const violations = await page.evaluate(() => window.__cspViolations ?? []);
  expect(violations, `${where} で CSP の違反`).toEqual([]);
  expect(consoleErrors, `${where} で CSP の違反(console)`).toEqual([]);
}

test("ログイン前の画面: CSP があり、違反が無い", async ({ page }) => {
  const consoleErrors = await watchCsp(page);
  const res = await page.goto("/login");
  const csp = res?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'self'");
  expect(csp).toMatch(/script-src 'self' 'nonce-/);
  await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible();
  // SSR が埋め込んだスクリプト(src の無い物)には、その応答の nonce が付いている。
  // TanStack は描き終えると埋め込みを消すので、届いた HTML のまま見る
  const raw = await page.request.get("/login");
  const nonce = (raw.headers()["content-security-policy"] ?? "").split("'nonce-")[1]?.split("'")[0];
  const inline = (await raw.text()).match(/<script(?![^>]*\ssrc=)[^>]*>/g) ?? [];
  expect(inline.length).toBeGreaterThan(0);
  for (const tag of inline) expect(tag).toContain(`nonce="${nonce}"`);
  await expectNoViolations(page, consoleErrors, "/login");

  for (const path of ["/legal/terms", "/no-such", "/design-system"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoViolations(page, consoleErrors, path);
  }
});

test("ログインの後: 画面を移り、操作しても違反が無い", async ({ page }) => {
  const consoleErrors = await watchCsp(page);
  await loginAs(page, "admin@acme.test");
  await expectNoViolations(page, consoleErrors, "ログインの後");
  // ページを読み直さない移動(ブラウザの中で描く)
  await page.getByRole("link", { name: "設定" }).click();
  await expect(page.getByRole("heading", { name: "設定", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "プロジェクト" }).first().click();
  await expect(page.getByRole("heading", { name: "プロジェクト", level: 1 })).toBeVisible();
  await expectNoViolations(page, consoleErrors, "画面の移動");
});

test("nonce の無い埋め込みのスクリプトは止まる", async ({ page }) => {
  const consoleErrors = await watchCsp(page);
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible();
  await page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent = "window.__injected = true";
    document.body.append(s);
  });
  expect(await page.evaluate(() => window.__injected)).toBeUndefined();
  const violations = await page.evaluate(() => window.__cspViolations ?? []);
  expect(violations.map((v) => v.directive)).toContain("script-src-elem");
  expect(consoleErrors.length).toBeGreaterThan(0);
});

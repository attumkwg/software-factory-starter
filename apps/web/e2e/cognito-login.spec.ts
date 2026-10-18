import { expect, type Page, test } from "@playwright/test";
import { expectAccessible } from "./helpers.ts";

// Cognito でのログイン(偽物の Cognito)。docker-compose.cognito.yml を重ねて立てたときだけ流す:
//   docker compose -f docker-compose.yml -f docker-compose.cognito.yml up --build -d
//   E2E_AUTH=cognito pnpm test:e2e
// 本物の Cognito の画面(Managed Login)は stg で人が確かめる(docs/runbooks/cognito-login.md)。

async function signInAtCognito(page: Page, email: string, opts: { verified?: boolean } = {}) {
  await expect(page.getByRole("heading", { name: "偽物の Cognito" })).toBeVisible();
  await page.getByLabel("メールアドレス", { exact: true }).fill(email);
  if (opts.verified === false) await page.getByLabel("メールアドレスは確認済み").uncheck();
  await page.getByRole("button", { name: "ログイン" }).click();
}

test("開こうとした画面 → ログイン → Cognito → 元の画面に戻る → ログアウトで Cognito 側も終わる", async ({
  page,
}) => {
  const tokens: string[] = [];
  page.on("response", async (res) => {
    // トークンはサーバーの中だけ: ブラウザに届く応答の本文に ID トークン(eyJ…)が出ない
    if (res.url().startsWith("http://localhost:8080") && res.status() < 300) {
      const body = await res.text().catch(() => "");
      if (/eyJ[\w-]+\.[\w-]+\./.test(body)) tokens.push(res.url());
    }
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible();
  await expect(page.getByLabel("メールアドレス")).toHaveCount(0); // 開発用ログインは出ない
  await expectAccessible(page);
  await page.getByRole("button", { name: "ログイン" }).click();

  await signInAtCognito(page, "member@acme.test");
  await expect(page.getByRole("heading", { name: "プロジェクト" })).toBeVisible();
  await expect(page.getByTestId("role")).toHaveAttribute("data-role", "member");

  // ブラウザの JS から読める所にトークンもセッションも無い(Cookie は HttpOnly)
  expect(await page.evaluate(() => document.cookie)).toBe("");
  // (ルーターがスクロールの位置を sessionStorage に置くのは問題ない)
  const stored = await page.evaluate(
    () => JSON.stringify(localStorage) + JSON.stringify(sessionStorage),
  );
  expect(stored).not.toMatch(/eyJ|id_token|access_token|code_verifier/);

  const cognitoLogout = page.waitForRequest((req) =>
    req.url().startsWith("http://fake-cognito.localhost:9231/logout?"),
  );
  await page.getByRole("button", { name: "ログアウト" }).click();
  await cognitoLogout;
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible();
  expect(tokens).toEqual([]);
});

test("ログインの後は、開こうとしていた画面に戻る", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "ログイン" }).click();
  await signInAtCognito(page, "admin@acme.test");
  await page.getByRole("link", { name: "Acme の立ち上げ" }).first().click();
  await expect(page).toHaveURL(/\/projects\//);
  const projectUrl = page.url();
  await page.context().clearCookies();

  await page.goto(projectUrl);
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await page.getByRole("button", { name: "ログイン" }).click();
  await signInAtCognito(page, "admin@acme.test");
  await expect(page).toHaveURL(projectUrl);
});

test("users にいない人・確認していないメールは「ログインできませんでした」", async ({ page }) => {
  for (const [email, verified] of [
    ["stranger@example.test", true],
    ["viewer@acme.test", false],
  ] as const) {
    await page.goto("/login");
    await page.getByRole("button", { name: "ログイン" }).click();
    await signInAtCognito(page, email, { verified });
    await expect(page).toHaveURL(/\/login\?error=login_failed/);
    await expect(page.getByRole("alert")).toHaveText("ログインできませんでした");
    await expectAccessible(page);
  }
});

import { expect, type Page, test } from "@playwright/test";
import { FAKE } from "./cognito-helpers.ts";
import { expectAccessible } from "./helpers.ts";

// 会社のアカウント(SSO)でのログイン(docs/specs/0056-sso-scim-ip-audit-export.md・設計書 0056 の 0)。
// 種データの Initech(initech.test を確かめ済み・機能 sso・IdP org-seed-initech をつないだ組織)と、
// 偽物の Cognito の「テスト用の IdP」(メールを入れるだけで戻る)を使う。docker-compose.cognito.yml を重ねたときだけ流す。
// 本物の SAML は stg でテスト用の IdP を使って人が確かめる(設計書 0056 の U-8)。必須・緊急用の流れは API の結合テスト。

const MEMBER = "member@initech.test";

/** ログインの画面から「会社のアカウントでログイン」→ メール → テスト用の IdP の画面まで */
async function toIdp(page: Page, email: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "会社のアカウントでログイン" }).click();
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByRole("button", { name: "会社のアカウントへ進む" }).click();
}

/** テスト用の IdP の画面で、IdP がこのメールの人を返す */
async function idpSignIn(page: Page, asserted: string) {
  await expect(page).toHaveURL(new RegExp(`^${FAKE}/oauth2/authorize`));
  await expect(page.getByRole("heading", { name: /テスト用の IdP/ })).toBeVisible();
  await page.getByLabel("会社のメールアドレス").fill(asserted);
  await page.getByRole("button", { name: "会社のアカウントでログイン" }).click();
}

test("会社のアカウントでログイン → IdP → 戻るとその組織に入る(パスワードを入れない)", async ({
  page,
}) => {
  await page.goto("/login");
  await expectAccessible(page);
  await toIdp(page, MEMBER);
  await idpSignIn(page, MEMBER);
  await expect(page.getByRole("heading", { name: "プロジェクト" })).toBeVisible();
  await expect(page.getByTestId("role")).toHaveAttribute("data-role", "member");
  // セッションは HttpOnly の Cookie だけ(トークンも途中の状態も JS から読めない)
  expect(await page.evaluate(() => document.cookie)).toBe("");
});

test("SSO ではないメールは、パスワードの段へ戻す(人がいるかは言わない)", async ({ page }) => {
  await toIdp(page, "someone@acme.test");
  await expect(page.getByText("会社のアカウントでのログインに対応していません")).toBeVisible();
  await expect(page.getByLabel("パスワード", { exact: true })).toBeVisible();
  await expectAccessible(page);
});

test("その組織にいない人を IdP が返したら、ログインの画面に戻して理由は言わない", async ({
  page,
}) => {
  await toIdp(page, MEMBER);
  await idpSignIn(page, "ghost@initech.test");
  await expect(page).toHaveURL(/\/login\?sso=failed/);
  await expect(page.getByText("会社のアカウントでログインできませんでした")).toBeVisible();
  await expectAccessible(page);
});

test("管理者は設定で SSO の欄(つないだ・緊急用の候補)を見られる", async ({ page }) => {
  await toIdp(page, "admin@initech.test");
  await idpSignIn(page, "admin@initech.test");
  await expect(page.getByRole("heading", { name: "プロジェクト" })).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "会社のアカウント(SSO)" })).toBeVisible();
  await expect(page.getByText("つないだ(任意)")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /緊急用: Initech 管理者/ })).toBeVisible();
  // 緊急用を選ぶまで、必須にはできない(守りは API。必須の流れは結合テスト sso-required.int.test.ts)
  await expect(page.getByRole("button", { name: "必須にする" })).toBeDisabled();
  await expectAccessible(page);
});

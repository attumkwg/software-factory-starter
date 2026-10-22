import { totp } from "@app/fake-cognito";
import { expect, type Page, test } from "@playwright/test";
import { fillLogin, PASSWORD, register } from "./cognito-helpers.ts";
import { expectAccessible } from "./helpers.ts";

// アカウントの安全(docs/specs/0006-account-security.md)を、自前の画面と偽物の Cognito で通す。
//   1. 二段階認証を画面で設定する → 次のログインでコードを聞かれる → 管理者が組織の必須を入れる・切る
//   2. 運営の組織は最初から必須: 社員はログインすると設定の画面へ回される → 設定して代理で入る → 代理の最中は変えられない
// ほかの cognito-*.spec.ts と人がぶつからないよう、Globex の管理者と運営の社員を使う。同じ人を使うので順に流す。

test.describe.configure({ mode: "serial" });

const GLOBEX_ADMIN = "admin@globex.test";
const STAFF = "support@ops.test";
/** Globex の管理者の鍵(1つ目で設定し、2つ目でサポートへの許可を出すのに使う) */
let adminSecret = "";

/** アカウントの画面で、パスワードを入れ直して二段階認証を設定する。鍵を返す */
async function setUpMfa(page: Page): Promise<string> {
  await page.getByRole("button", { name: "二段階認証を設定する" }).click();
  // 同じ画面にパスワードの変更の欄もあるので、入れ直しのフォームの中で探す
  const reauth = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "パスワードを確かめる" }) });
  await reauth.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await reauth.getByRole("button", { name: "パスワードを確かめる" }).click();
  await expect(page.getByRole("img", { name: "認証アプリに読ませる QR コード" })).toBeVisible();
  await expectAccessible(page);
  const secret = ((await page.getByTestId("mfa-secret").textContent()) ?? "").replace(/\s/g, "");
  await page.getByLabel("確認コード(認証アプリ)").fill("000000");
  await page.getByRole("button", { name: "有効にする" }).click();
  await expect(page.getByRole("alert")).toContainText("コードが違うか");
  await page.getByLabel("確認コード(認証アプリ)").fill(totp(secret));
  await page.getByRole("button", { name: "有効にする" }).click();
  await expect(page.getByText("二段階認証を有効にしました")).toBeVisible();
  await expect(page.getByText("有効", { exact: true })).toBeVisible();
  return secret;
}

async function logInWithCode(page: Page, email: string, secret: string) {
  await page.goto("/login");
  await fillLogin(page, email, PASSWORD);
  await page.getByLabel("確認コード(認証アプリ)").fill(totp(secret));
  await page.getByRole("button", { name: "確かめる" }).click();
}

test("二段階認証を画面で設定すると、次のログインでコードを聞かれる。管理者は組織の必須を入れ・切れる", async ({
  page,
  request,
}) => {
  await register(request, GLOBEX_ADMIN);
  await page.goto("/login");
  await fillLogin(page, GLOBEX_ADMIN, PASSWORD);
  await page.getByRole("link", { name: "アカウント" }).click();
  await expect(page.getByRole("heading", { name: "アカウント" })).toBeVisible();
  await expectAccessible(page);
  adminSecret = await setUpMfa(page);

  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await logInWithCode(page, GLOBEX_ADMIN, adminSecret);
  await expect(page.getByRole("heading", { name: "プロジェクト" })).toBeVisible();

  await page.getByRole("link", { name: "設定" }).click();
  await page.getByRole("button", { name: "全員に必須にする" }).click();
  await expect(page.getByRole("dialog")).toContainText("次の操作から二段階認証の設定の画面へ");
  await page.getByRole("dialog").getByRole("button", { name: "必須にする" }).click();
  await expect(page.getByText("全員に必須", { exact: true })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: "必須を切る" }).click();
  await expect(page.getByText("任意", { exact: true })).toBeVisible();
});

test("運営の組織は必須: 社員は設定の画面へ回される。設定して代理で入ると、代理の最中は変えられない", async ({
  page,
  browser,
  request,
}) => {
  // Globex の管理者がサポートへの許可を出す(番号はこの応答にだけ出る)
  const admin = await browser.newPage();
  await logInWithCode(admin, GLOBEX_ADMIN, adminSecret);
  await expect(admin.getByRole("heading", { name: "プロジェクト" })).toBeVisible();
  const grant = await admin.request.post("/api/support-grants", {
    data: { hours: 1 },
    headers: { origin: new URL(process.env.E2E_BASE_URL ?? "http://localhost:8080").origin },
  });
  const { code } = (await grant.json()) as { code: string };
  await admin.close();

  await register(request, STAFF);
  await page.goto("/login");
  await fillLogin(page, STAFF, PASSWORD);
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText("この組織では二段階認証が必須です")).toBeVisible();
  // ほかの画面を開いても、設定の画面へ戻される
  await page.goto("/support");
  await expect(page).toHaveURL(/\/account$/);
  await setUpMfa(page);

  await page.getByRole("link", { name: "サポート", exact: true }).click();
  await page.getByLabel("サポート番号").fill(code);
  await page.getByRole("button", { name: "入る" }).click();
  await expect(page.getByTestId("support-banner")).toBeVisible();
  await expect(page.getByRole("link", { name: "アカウント" })).toHaveCount(0);
  await page.goto("/account");
  await expect(page.getByText("代理ログイン中は、アカウントを変えられません")).toBeVisible();
  // 画面で隠すだけでなく、API でも止まっていること(守りは API 側)
  const status = await page.evaluate(async () => {
    const res = await fetch("/api/account/reauth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "x" }),
    });
    return res.status;
  });
  expect(status).toBe(403);
});

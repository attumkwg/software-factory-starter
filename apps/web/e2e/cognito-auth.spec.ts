import { totp } from "@app/fake-cognito";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { expectAccessible } from "./helpers.ts";

// 自前の画面での Cognito のログイン(偽物の Cognito)。docker-compose.cognito.yml を重ねて立てたときだけ流す:
//   docker compose -f docker-compose.yml -f docker-compose.cognito.yml up --build -d
//   E2E_AUTH=cognito pnpm test:e2e
// 確認コードのメールは Postfix を通って Mailpit に届くので、Mailpit の API で読む。
// 偽物が本物と同じかは、packages/fake-cognito/contract の契約テストが確かめる。

const FAKE = process.env.FAKE_COGNITO_URL ?? "http://localhost:9231";
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";
const POOL = "local_fakepool";
const CLIENT = "local-web-client";
// 偽物の Cognito だけで使う試しのパスワード(本物の秘密ではない)
// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_password
const PASSWORD = "Correct-Horse-42";

/** 偽物の Cognito に直接話す(人を消す・二段階認証を設定する) */
async function cognito<T>(action: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${FAKE}/`, {
    method: "POST",
    headers: { "x-amz-target": `AWSCognitoIdentityProviderService.${action}` },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

/** 前の実行で残った人を消す(偽物は動いている間、人を覚えている) */
const forget = (email: string) => cognito("AdminDeleteUser", { UserPoolId: POOL, Username: email });

type Summary = { ID: string };
async function messageIds(email: string): Promise<string[]> {
  const q = encodeURIComponent(`to:"${email}"`);
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${q}`);
  return ((await res.json()) as { messages: Summary[] }).messages.map((m) => m.ID);
}

/** 操作の前に無かった、新しい確認コードのメール(Postfix → Mailpit)を待って、コードを読む */
async function newCode(email: string, before: string[]): Promise<string> {
  let code = "";
  await expect
    .poll(
      async () => {
        const fresh = (await messageIds(email)).find((id) => !before.includes(id));
        if (!fresh) return "";
        const res = await fetch(`${MAILPIT}/api/v1/message/${fresh}`);
        code = ((await res.json()) as { Text: string }).Text.match(/\d{6}/)?.[0] ?? "";
        return code;
      },
      { timeout: 15_000 },
    )
    .toMatch(/^\d{6}$/);
  return code;
}

/** 画面を通さずに、登録と確認だけ済ませる(API を画面と同じ形で叩く) */
async function register(request: APIRequestContext, email: string) {
  await forget(email);
  const headers = { origin: "http://localhost:8080" };
  const before = await messageIds(email);
  await request.post("/api/auth/sign-up", { data: { email, password: PASSWORD }, headers });
  const code = await newCode(email, before);
  await request.post("/api/auth/confirm-sign-up", { data: { email, code }, headers });
}

async function fillLogin(page: Page, email: string, password: string) {
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード", { exact: true }).fill(password);
  await page.getByRole("button", { name: "ログイン" }).click();
}

test("登録 → メールの確認コード → ログイン → 開こうとしていた画面へ。トークンはブラウザに来ない", async ({
  page,
}) => {
  const email = "viewer@acme.test";
  await forget(email);
  const tokens: string[] = [];
  page.on("response", async (res) => {
    if (res.url().startsWith("http://localhost:8080") && res.status() < 300) {
      const body = await res.text().catch(() => "");
      if (/eyJ[\w-]+\.[\w-]+\./.test(body)) tokens.push(res.url());
    }
  });

  await page.goto("/");
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await expectAccessible(page);
  await page.getByRole("link", { name: "初めての方は登録" }).click();
  await expect(page.getByRole("heading", { name: "登録" })).toBeVisible();
  await expectAccessible(page);

  await page.getByLabel("メールアドレス").fill(email);
  // 決まりを満たさないパスワードは、送る前に画面で知らせる
  await page.getByLabel("新しいパスワード").fill("short");
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByText(/足りないもの/)).toBeVisible();

  const before = await messageIds(email);
  await page.getByLabel("新しいパスワード").fill(PASSWORD);
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByLabel("確認コード(メール)")).toBeVisible();
  await page.getByLabel("確認コード(メール)").fill(await newCode(email, before));
  await page.getByRole("button", { name: "確かめる" }).click();

  await expect(page.getByText("登録できました")).toBeVisible();
  await fillLogin(page, email, PASSWORD);
  await expect(page.getByRole("heading", { name: "プロジェクト" })).toBeVisible();
  await expect(page.getByTestId("role")).toHaveAttribute("data-role", "viewer");

  // ブラウザの JS から読める所にトークンもセッションも無い(Cookie は HttpOnly)
  expect(await page.evaluate(() => document.cookie)).toBe("");
  const stored = await page.evaluate(
    () => JSON.stringify(localStorage) + JSON.stringify(sessionStorage),
  );
  expect(stored).not.toMatch(/eyJ|IdToken|AccessToken|password/i);
  expect(tokens).toEqual([]);

  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("パスワード違い・users にいない人は、同じ「メールアドレスかパスワードが正しくありません」", async ({
  page,
  request,
}) => {
  await register(request, "member@acme.test");
  await register(request, "stranger@example.test");
  for (const [email, password] of [
    ["member@acme.test", "Wrong-Password-1"],
    ["stranger@example.test", PASSWORD],
    ["nobody@example.test", PASSWORD],
  ] as const) {
    await page.goto("/login");
    await fillLogin(page, email, password);
    // 問い合わせ番号が後ろに付く
    await expect(page.getByRole("alert")).toContainText(
      "メールアドレスかパスワードが正しくありません",
    );
  }
  await expectAccessible(page);
});

test("パスワードを忘れた → メールのコードと新しいパスワード → 新しいパスワードでログイン", async ({
  page,
  request,
}) => {
  const email = "member@acme.test";
  await register(request, email);
  await page.goto("/login");
  await page.getByRole("link", { name: "パスワードを忘れた" }).click();
  await expectAccessible(page);
  const before = await messageIds(email);
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByRole("button", { name: "コードを送る" }).click();
  await page.getByLabel("確認コード(メール)").fill(await newCode(email, before));
  await page.getByLabel("新しいパスワード").fill("New-Password-777");
  await page.getByRole("button", { name: "パスワードを変える" }).click();

  await expect(page.getByText("パスワードを変えました")).toBeVisible();
  await fillLogin(page, email, "New-Password-777");
  await expect(page.getByRole("heading", { name: "プロジェクト" })).toBeVisible();
});

test("二段階認証: パスワードの次に認証アプリのコードを聞かれる。間違えたらパスワードから", async ({
  page,
  request,
}) => {
  const email = "admin@acme.test";
  await register(request, email);
  // 設定の画面は次の PR。偽物の Cognito に直接、TOTP を有効にする
  const signedIn = await cognito<{ AuthenticationResult: { AccessToken: string } }>(
    "InitiateAuth",
    {
      ClientId: CLIENT,
      AuthFlow: "USER_PASSWORD_AUTH",
      AuthParameters: { USERNAME: email, PASSWORD },
    },
  );
  const accessToken = signedIn.AuthenticationResult.AccessToken;
  const { SecretCode } = await cognito<{ SecretCode: string }>("AssociateSoftwareToken", {
    AccessToken: accessToken,
  });
  await cognito("VerifySoftwareToken", { AccessToken: accessToken, UserCode: totp(SecretCode) });
  await cognito("SetUserMFAPreference", {
    AccessToken: accessToken,
    SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true },
  });

  await page.goto("/login");
  await fillLogin(page, email, PASSWORD);
  await page.getByLabel("確認コード(認証アプリ)").fill("000000");
  await page.getByRole("button", { name: "確かめる" }).click();
  await expect(page.getByText("もう一度、パスワードから入力してください")).toBeVisible();

  await fillLogin(page, email, PASSWORD);
  await expectAccessible(page);
  await page.getByLabel("確認コード(認証アプリ)").fill(totp(SecretCode));
  await page.getByRole("button", { name: "確かめる" }).click();
  await expect(page.getByRole("heading", { name: "プロジェクト" })).toBeVisible();
  await expect(page.getByTestId("role")).toHaveAttribute("data-role", "admin");
});

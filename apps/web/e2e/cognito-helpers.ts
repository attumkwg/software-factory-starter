import { type APIRequestContext, expect, type Page } from "@playwright/test";

// Cognito のログインの E2E(cognito-*.spec.ts)が使い回す部品。偽物の Cognito と Mailpit に直接話す。

export const FAKE = process.env.FAKE_COGNITO_URL ?? "http://localhost:9231";
export const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";
export const POOL = "local_fakepool";
export const CLIENT = "local-web-client";
// 偽物の Cognito だけで使う試しのパスワード(本物の秘密ではない)
// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_password
export const PASSWORD = "Correct-Horse-42";

/** 偽物の Cognito に直接話す(人を消す・二段階認証を設定する) */
export async function cognito<T>(action: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${FAKE}/`, {
    method: "POST",
    headers: { "x-amz-target": `AWSCognitoIdentityProviderService.${action}` },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

/** 前の実行で残った人を消す(偽物は動いている間、人を覚えている) */
export const forget = (email: string) =>
  cognito("AdminDeleteUser", { UserPoolId: POOL, Username: email });

type Summary = { ID: string };
export async function messageIds(email: string): Promise<string[]> {
  const q = encodeURIComponent(`to:"${email}"`);
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${q}`);
  return ((await res.json()) as { messages: Summary[] }).messages.map((m) => m.ID);
}

/** 操作の前に無かった、新しい確認コードのメール(Postfix → Mailpit)を待って、コードを読む */
export async function newCode(email: string, before: string[]): Promise<string> {
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
export async function register(request: APIRequestContext, email: string) {
  await forget(email);
  const headers = { origin: new URL(process.env.E2E_BASE_URL ?? "http://localhost:8080").origin };
  const before = await messageIds(email);
  await request.post("/api/auth/sign-up", { data: { email, password: PASSWORD }, headers });
  const code = await newCode(email, before);
  await request.post("/api/auth/confirm-sign-up", { data: { email, code }, headers });
}

export async function fillLogin(page: Page, email: string, password: string) {
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード", { exact: true }).fill(password);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
}

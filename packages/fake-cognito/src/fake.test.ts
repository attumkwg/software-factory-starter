import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FakeCognito, fakeSub } from "./fake.ts";

// 偽物が「本物と同じく断る」こと。偽物が甘いと、API 側の確かめ漏れにテストで気づけない。

const BASE = "http://fake.test";
const CALLBACK = "http://app.test/api/auth/callback";
const fake = new FakeCognito({
  baseUrl: BASE,
  clientId: "web",
  callbackUrls: [CALLBACK],
  logoutUrls: ["http://app.test/login"],
});

const verifier = "v".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");
const authorizeParams = (over: Record<string, string> = {}) =>
  new URLSearchParams({
    response_type: "code",
    client_id: "web",
    redirect_uri: CALLBACK,
    state: "s",
    nonce: "n",
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...over,
  });

async function getCode(email = "A@Example.test") {
  const form = authorizeParams();
  form.set("email", email);
  form.set("email_verified", "true");
  form.set("action", "login");
  const res = await fake.fetch(
    new Request(`${BASE}/oauth2/authorize`, { method: "POST", body: form }),
  );
  return new URL(res.headers.get("location") ?? "").searchParams.get("code") ?? "";
}

const token = (code: string, over: Record<string, string> = {}) =>
  fake.fetch(
    new Request(`${BASE}/oauth2/token`, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: "web",
        code,
        redirect_uri: CALLBACK,
        code_verifier: verifier,
        ...over,
      }),
    }),
  );

describe("偽物の Cognito", () => {
  it.each([
    ["登録されていない戻り先", { redirect_uri: "https://evil.example/cb" }],
    ["違う client_id", { client_id: "other" }],
    ["PKCE が無い", { code_challenge: "" }],
  ])("%s は、戻さずにその場で断る", async (_, over) => {
    const res = await fake.fetch(new Request(`${BASE}/oauth2/authorize?${authorizeParams(over)}`));
    expect(res.status).toBe(400);
  });

  it("正しい code と verifier なら ID トークン。2回目は断る", async () => {
    const code = await getCode();
    const first = await token(code);
    expect(first.status).toBe(200);
    const { id_token } = (await first.json()) as { id_token: string };
    const payload = JSON.parse(Buffer.from(id_token.split(".")[1] ?? "", "base64url").toString());
    expect(payload).toMatchObject({
      iss: fake.issuer,
      aud: "web",
      token_use: "id",
      nonce: "n",
      email: "a@example.test",
      email_verified: true,
      sub: fakeSub("a@example.test"),
    });
    expect((await token(code)).status).toBe(400);
  });

  it("verifier が違えば断る", async () => {
    expect((await token(await getCode(), { code_verifier: "w".repeat(43) })).status).toBe(400);
  });

  it("ログアウトは、登録された戻り先にだけ返す", async () => {
    const ok = await fake.fetch(
      new Request(
        `${BASE}/logout?client_id=web&logout_uri=${encodeURIComponent("http://app.test/login")}`,
      ),
    );
    expect(ok.status).toBe(302);
    const ng = await fake.fetch(
      new Request(
        `${BASE}/logout?client_id=web&logout_uri=${encodeURIComponent("https://evil.example/")}`,
      ),
    );
    expect(ng.status).toBe(400);
  });
});

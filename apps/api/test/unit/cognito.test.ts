import { FakeCognito } from "@app/fake-cognito";
import { createLocalJWKSet } from "jose";
import { describe, expect, it } from "vitest";
import { CognitoClient, CognitoError } from "../../src/auth/providers.ts";
import { ApiError } from "../../src/errors.ts";

// Cognito の API の呼び方と、ID トークンの確かめ方(DB 無し)。流れ全体は test/integration/cognito-login.int.test.ts。

const settings = {
  region: "ap-northeast-1",
  userPoolId: "local_pool",
  clientId: "client-1",
  appUrl: "https://app.test",
  endpoint: "https://fake-cognito.test",
};
const fake = new FakeCognito({
  baseUrl: settings.endpoint,
  userPoolId: "local_pool",
  clientId: "client-1",
});
const jwks = createLocalJWKSet(fake.jwks as never);
const withFetch = (fetch: typeof globalThis.fetch) => new CognitoClient(settings, { jwks, fetch });
const client = withFetch((input, init) => fake.fetch(new Request(input, init)));
const answer = (status: number, body: unknown) => async () =>
  new Response(JSON.stringify(body), { status });

describe("Cognito の API の呼び方", () => {
  it("断られたら、Cognito の例外の名前を持った CognitoError", async () => {
    const err = await client.signIn("nobody@example.test", "Whatever-123456").catch((e) => e);
    expect(err).toBeInstanceOf(CognitoError);
    expect(err.type).toBe("NotAuthorizedException");
  });

  it("名前に頭(com.amazonaws…#)が付いていても読める", async () => {
    const c = withFetch(answer(400, { __type: "com.amazonaws.cognito#CodeMismatchException" }));
    expect((await c.confirmSignUp("a@example.test", "123456").catch((e) => e)).type).toBe(
      "CodeMismatchException",
    );
  });

  it.each([
    ["届かない", () => Promise.reject(new TypeError("fetch failed"))],
    ["5xx", answer(502, { message: "bad gateway" })],
    ["Cognito の中の失敗", answer(400, { __type: "InternalErrorException" })],
    ["形の分からない答え", async () => new Response("<html>", { status: 400 })],
  ])("%s は 503(ログインの失敗と混ぜない)", async (_, f) => {
    const err = await withFetch(f as typeof fetch)
      .forgotPassword("a@example.test")
      .catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(503);
  });

  it.each(["TooManyRequestsException", "LimitExceededException", "TooManyFailedAttemptsException"])(
    "%s は 429(少し待てば通る)",
    async (type) => {
      const err = await withFetch(answer(400, { __type: type }))
        .signIn("a@example.test", "x")
        .catch((e) => e);
      expect(err.status).toBe(429);
      expect(err.code).toBe("too_many_requests");
    },
  );

  it("ログアウトの後はアプリのログイン画面", () => {
    expect(client.logoutUrl).toBe("https://app.test/login");
  });
});

describe("ID トークンの確かめ方", () => {
  it("正しい ID トークンなら sub と、確認済みならメールを返す", async () => {
    const t = fake.signIdToken({
      sub: "s1",
      aud: "client-1",
      email: "a@example.test",
      email_verified: true,
      exp: 4e9,
    });
    expect(await client.verify(t)).toEqual({
      kind: "external",
      externalId: "s1",
      verifiedEmail: "a@example.test",
    });
  });

  it("確認していないメールは返さない(users と結びつけない)", async () => {
    const t = fake.signIdToken({
      sub: "s1",
      aud: "client-1",
      email: "a@example.test",
      email_verified: false,
      exp: 4e9,
    });
    expect(await client.verify(t)).toMatchObject({ verifiedEmail: null });
  });

  it("アクセストークン・別のアプリ宛て・別の発行元・切れたもの・壊れたものは受け付けない", async () => {
    const base = { sub: "s1", aud: "client-1", exp: 4e9 };
    for (const t of [
      fake.signIdToken({ ...base, token_use: "access" }),
      fake.signIdToken({ ...base, aud: "other" }),
      fake.signIdToken({ ...base, iss: "https://evil.example" }),
      fake.signIdToken({ ...base, exp: 1 }),
      "not-a-jwt",
    ]) {
      expect(await client.verify(t)).toBeNull();
    }
  });
});

import { FakeCognito } from "@app/fake-cognito";
import { createLocalJWKSet } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { CognitoClient, CognitoRejected, pkceChallenge } from "../../src/auth/providers.ts";
import { ApiError } from "../../src/errors.ts";

// 本物の Cognito にはつながず、偽物の Cognito(packages/fake-cognito)で「確かめ方」が正しいかを見る。
// ログインの流れ全体(DB で users と結びつく所まで)は test/integration/cognito-login.int.test.ts。

const APP_URL = "https://app.test";
const settings = {
  region: "ap-northeast-1",
  userPoolId: "ap-northeast-1_test",
  clientId: "client-1",
  domain: "https://fake-cognito.test",
  appUrl: APP_URL,
  issuer: "https://fake-cognito.test/ap-northeast-1_test",
  scanClientId: "scanner-1",
};

const fake = new FakeCognito({
  baseUrl: settings.domain,
  userPoolId: settings.userPoolId,
  clientId: settings.clientId,
  callbackUrls: [`${APP_URL}/api/auth/callback`],
  logoutUrls: [`${APP_URL}/login`],
});

let client: CognitoClient;
beforeAll(() => {
  client = new CognitoClient(settings, {
    jwks: createLocalJWKSet(fake.jwks as never),
    fetch: (input, init) => fake.fetch(new Request(input, init)),
  });
});

/** 偽物の画面でログインして、戻り先に付いた code を受け取る */
async function codeFor(email: string, opts: { verified?: boolean; nonce?: string } = {}) {
  const verifier = "v".repeat(43);
  const url = new URL(
    client.authorizeUrl({ state: "s1", nonce: opts.nonce ?? "n1", codeVerifier: verifier }),
  );
  const form = new URLSearchParams(url.searchParams);
  form.set("email", email);
  form.set("action", "login");
  if (opts.verified !== false) form.set("email_verified", "true");
  const res = await fake.fetch(
    new Request(`${settings.domain}/oauth2/authorize`, { method: "POST", body: form }),
  );
  const back = new URL(res.headers.get("location") ?? "");
  return {
    code: back.searchParams.get("code") ?? "",
    verifier,
    state: back.searchParams.get("state"),
  };
}

describe("Cognito の画面へ送る URL", () => {
  it("PKCE(S256)・state・nonce を付け、戻り先は API の callback", () => {
    const url = new URL(client.authorizeUrl({ state: "s", nonce: "n", codeVerifier: "abc" }));
    expect(url.origin + url.pathname).toBe("https://fake-cognito.test/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: "code",
      client_id: "client-1",
      redirect_uri: "https://app.test/api/auth/callback",
      state: "s",
      nonce: "n",
      code_challenge: pkceChallenge("abc"),
      code_challenge_method: "S256",
    });
  });

  it("ログアウトは Cognito 側も終わらせて、ログイン画面へ戻る", () => {
    const url = new URL(client.logoutUrl);
    expect(url.pathname).toBe("/logout");
    expect(url.searchParams.get("logout_uri")).toBe("https://app.test/login");
  });
});

describe("code をトークンに替える", () => {
  it("確認済みのメールなら、sub とメールを返す", async () => {
    const { code, verifier, state } = await codeFor("a@example.test");
    expect(state).toBe("s1");
    expect(await client.exchange(code, verifier, "n1")).toMatchObject({
      kind: "external",
      verifiedEmail: "a@example.test",
    });
  });

  it("確認していないメールは、結びつけに使わない", async () => {
    const { code, verifier } = await codeFor("b@example.test", { verified: false });
    expect(await client.exchange(code, verifier, "n1")).toMatchObject({ verifiedEmail: null });
  });

  it("nonce が違う(別のログインのトークン)は受け付けない", async () => {
    const { code, verifier } = await codeFor("a@example.test", { nonce: "other" });
    await expect(client.exchange(code, verifier, "n1")).rejects.toBeInstanceOf(CognitoRejected);
  });

  it("PKCE の verifier が違う・code の使い回しは受け付けない", async () => {
    const { code, verifier } = await codeFor("a@example.test");
    await expect(client.exchange(code, "w".repeat(43), "n1")).rejects.toBeInstanceOf(
      CognitoRejected,
    );
    // 偽物も本物と同じく、失敗しても code は使い済みになる
    await expect(client.exchange(code, verifier, "n1")).rejects.toBeInstanceOf(CognitoRejected);
  });

  it("Cognito に届かない・Cognito が 5xx は 503(ログインの失敗と混ぜない)", async () => {
    const down = new CognitoClient(settings, {
      jwks: createLocalJWKSet(fake.jwks as never),
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });
    const err = await down.exchange("c", "v", "n").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(503);

    const broken = new CognitoClient(settings, {
      jwks: createLocalJWKSet(fake.jwks as never),
      fetch: async () => new Response("oops", { status: 502 }),
    });
    expect((await broken.exchange("c", "v", "n").catch((e) => e)).status).toBe(503);
  });
});

describe("ID トークンの確かめ方", () => {
  const expected = { audience: "client-1", nonce: null };

  it("アクセストークンは受け付けない", async () => {
    const t = fake.signIdToken({ sub: "x", aud: "client-1", token_use: "access", exp: 4e9 });
    expect(await client.verify(t, expected)).toBeNull();
  });

  it("別のアプリ宛て・別の発行元・切れたものは受け付けない", async () => {
    expect(
      await client.verify(fake.signIdToken({ sub: "x", aud: "other", exp: 4e9 }), expected),
    ).toBeNull();
    expect(
      await client.verify(
        fake.signIdToken({ sub: "x", aud: "client-1", iss: "https://evil.example", exp: 4e9 }),
        expected,
      ),
    ).toBeNull();
    expect(
      await client.verify(fake.signIdToken({ sub: "x", aud: "client-1", exp: 1 }), expected),
    ).toBeNull();
  });

  it("壊れたトークンは受け付けない", async () => {
    expect(await client.verify("not-a-jwt", expected)).toBeNull();
  });

  it("スキャン用の口は、スキャン用のクライアント宛てだけ", async () => {
    const forWeb = fake.signIdToken({ sub: "x", aud: "client-1", exp: 4e9 });
    const forScan = fake.signIdToken({ sub: "x", aud: "scanner-1", exp: 4e9 });
    expect(await client.verifyScanToken(forWeb)).toBeNull();
    expect(await client.verifyScanToken(forScan)).toMatchObject({ externalId: "x" });
  });
});

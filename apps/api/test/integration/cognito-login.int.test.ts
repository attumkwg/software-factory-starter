import { FakeCognito, fakeSub, totp } from "@app/fake-cognito";
import { sql } from "drizzle-orm";
import { createLocalJWKSet } from "jose";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { CognitoClient } from "../../src/auth/providers.ts";
import { loadConfig } from "../../src/config.ts";
import { createDb } from "../../src/db/client.ts";
import { createLogger } from "../../src/logger.ts";
import { call, createTenantFixture, type TenantFixture } from "../helpers/fixtures.ts";

// 自前の画面からの Cognito でのログイン(ADR 0009)を、偽物の Cognito と本物の Postgres で通す。
//   登録 → 確認コード → ログイン →(二段階認証)→ Cookie → GET /api/me / パスワードの再設定
// トークンは API の中だけ: ブラウザが受け取るのは Cookie と「次にすること」だけ。
// 偽物が本物と同じ振る舞いかは、packages/fake-cognito/contract の契約テストが確かめる。

const COGNITO = "http://fake-cognito.test";
const POOL = "local_fakepool";
const CLIENT = "local-web-client";
const PASSWORD = "Correct-Horse-42";
const config = loadConfig({
  APP_ENV: "test",
  DATABASE_URL: inject("appUrl"),
  SESSION_SECRET: "test-only-".padEnd(40, "x"),
  AUTH_MODE: "cognito",
  COGNITO_REGION: "ap-northeast-1",
  COGNITO_USER_POOL_ID: POOL,
  COGNITO_CLIENT_ID: CLIENT,
  COGNITO_ENDPOINT: COGNITO,
});
if (config.auth.mode !== "cognito") throw new Error("cognito で組み立てる");

const fake = new FakeCognito({ baseUrl: COGNITO, userPoolId: POOL, clientId: CLIENT });
let cognitoUp = true;
const fakeFetch = (input: string | URL | Request, init?: RequestInit) =>
  cognitoUp ? fake.fetch(new Request(input, init)) : Promise.reject(new TypeError("fetch failed"));
const cognito = new CognitoClient(config.auth, {
  jwks: createLocalJWKSet(fake.jwks as never),
  fetch: fakeFetch,
});

const logs: string[] = [];
const owner = createDb(inject("ownerUrl"));
const { db, pool } = createDb(inject("appUrl"));
const app = createApp({
  config,
  db,
  logger: createLogger({ level: "info", destination: { write: (line) => logs.push(line) } }),
  cognito,
});

let acme: TenantFixture;
beforeAll(async () => {
  acme = await createTenantFixture(owner.db, "acme");
});
afterAll(async () => {
  await owner.pool.end();
  await pool.end();
});

const post = (path: string, body: unknown, cookie?: string) =>
  call(app, "POST", `/api/auth/${path}`, { body, cookie });

/** Set-Cookie から「名前=値」だけを取り出す(消す Cookie は除く) */
const cookiesOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0] ?? "")
    .filter((c) => !c.endsWith("="));
const cookie = (res: Response, name: string) =>
  cookiesOf(res).find((c) => c.startsWith(`${name}=`));

/** 偽物の Cognito に直接話す(二段階認証の設定など、まだ画面が無い操作) */
async function cognitoApi<T>(action: string, body: Record<string, unknown>): Promise<T> {
  const res = await fake.fetch(
    new Request(`${COGNITO}/`, {
      method: "POST",
      headers: { "x-amz-target": `AWSCognitoIdentityProviderService.${action}` },
      body: JSON.stringify(body),
    }),
  );
  return (await res.json()) as T;
}

/** 画面と同じ順番で、登録して確認コードを入れる */
async function signUpAndConfirm(email: string, password = PASSWORD) {
  expect(await (await post("sign-up", { email, password })).json()).toEqual({ next: "confirm" });
  const code = fake.lastCode(email);
  expect(code).toMatch(/^\d{6}$/);
  const confirmed = await post("confirm-sign-up", { email, code });
  expect(await confirmed.json()).toEqual({ next: "login" });
}

async function externalIdOf(userId: string) {
  const r = await owner.db.execute<{ external_id: string | null }>(
    sql`select external_id from organizations.users where id = ${userId}`,
  );
  return r.rows[0]?.external_id ?? null;
}

describe("登録とログイン", () => {
  it("登録 → 確認コード → ログイン: 確認済みのメールで users の行と結びつき、Cookie だけが返る", async () => {
    const email = acme.users.member.email;
    await signUpAndConfirm(email);
    const res = await post("login", { email, password: PASSWORD });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ next: "done" });
    // 本文にトークンが出ない
    expect(text).not.toMatch(/eyJ/);
    const sid = cookie(res, "sid");
    expect(sid).toBeDefined();
    const me = await call(app, "GET", "/api/me", { cookie: sid });
    expect(await me.json()).toMatchObject({ role: "member" });
    expect(await externalIdOf(acme.users.member.id)).toBe(fakeSub(email));
  });

  it("もう登録されているメールでの登録も、同じ答え(登録の有無が分からない)", async () => {
    const email = acme.users.member.email;
    const res = await post("sign-up", { email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ next: "confirm" });
  });

  it("パスワード違い・いない人・Cognito にはいるが users にいない人は、同じ 401 と同じ文", async () => {
    const stranger = `stranger-${Date.now()}@example.test`;
    await signUpAndConfirm(stranger);
    const answers = await Promise.all([
      post("login", { email: acme.users.member.email, password: "Wrong-Password-1" }),
      post("login", { email: `nobody-${Date.now()}@example.test`, password: PASSWORD }),
      post("login", { email: stranger, password: PASSWORD }),
    ]);
    const bodies = await Promise.all(
      answers.map(async (r) => ({
        status: r.status,
        ...((await r.json()) as { error: { code: string; message: string } }).error,
      })),
    );
    for (const b of bodies) {
      expect(b).toMatchObject({ status: 401, code: "login_failed", message: bodies[0]?.message });
      expect(b.message).not.toMatch(/登録|存在|いません/);
    }
  });

  it("確認コードがまだの人は、正しいパスワードなら確認の画面へ(コードを送り直す)", async () => {
    const email = `unconfirmed-${Date.now()}@example.test`;
    await post("sign-up", { email, password: PASSWORD });
    const first = fake.lastCode(email);
    const res = await post("login", { email, password: PASSWORD });
    expect(await res.json()).toEqual({ next: "confirm" });
    expect(fake.lastCode(email)).not.toBe(first);
    expect(cookie(res, "sid")).toBeUndefined();
  });

  it("決まりを満たさないパスワードは 400 invalid_password、違う確認コードは 400 invalid_code", async () => {
    const weak = await post("sign-up", {
      email: `weak-${Date.now()}@example.test`,
      password: "short",
    });
    expect(weak.status).toBe(400);
    expect(((await weak.json()) as { error: { code: string } }).error.code).toBe(
      "invalid_password",
    );
    const email = `code-${Date.now()}@example.test`;
    await post("sign-up", { email, password: PASSWORD });
    const wrong = await post("confirm-sign-up", { email, code: "000000" });
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as { error: { code: string } }).error.code).toBe("invalid_code");
  });

  it("管理の操作で確認されただけの人(メールが未確認)は、users と結びつかない", async () => {
    const fixture = await createTenantFixture(owner.db, "unverified");
    const email = fixture.users.viewer.email;
    await post("sign-up", { email, password: PASSWORD });
    await cognitoApi("AdminConfirmSignUp", { UserPoolId: POOL, Username: email });
    const res = await post("login", { email, password: PASSWORD });
    expect(res.status).toBe(401);
    expect(await externalIdOf(fixture.users.viewer.id)).toBeNull();
  });

  it("続けて間違えると Cognito が止める。それでも答えは同じ 401", async () => {
    const fixture = await createTenantFixture(owner.db, "lock");
    const email = fixture.users.admin.email;
    await signUpAndConfirm(email);
    for (let i = 0; i < 5; i++) await post("login", { email, password: "Wrong-Password-1" });
    const locked = await post("login", { email, password: PASSWORD });
    expect(locked.status).toBe(401);
    expect(((await locked.json()) as { error: { code: string } }).error.code).toBe("login_failed");
    expect(logs.some((l) => l.includes("NotAuthorizedException"))).toBe(true);
  });
});

describe("二段階認証", () => {
  let email: string;
  let secret: string;

  beforeAll(async () => {
    const fixture = await createTenantFixture(owner.db, "mfa");
    email = fixture.users.admin.email;
    await signUpAndConfirm(email);
    // 設定の画面は次の PR。Cognito の API で直接、TOTP を有効にする
    const first = await cognitoApi<{ AuthenticationResult: { AccessToken: string } }>(
      "InitiateAuth",
      {
        ClientId: CLIENT,
        AuthFlow: "USER_PASSWORD_AUTH",
        AuthParameters: { USERNAME: email, PASSWORD },
      },
    );
    const accessToken = first.AuthenticationResult.AccessToken;
    secret = (
      await cognitoApi<{ SecretCode: string }>("AssociateSoftwareToken", {
        AccessToken: accessToken,
      })
    ).SecretCode;
    await cognitoApi("VerifySoftwareToken", { AccessToken: accessToken, UserCode: totp(secret) });
    await cognitoApi("SetUserMFAPreference", {
      AccessToken: accessToken,
      SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true },
    });
  });

  it("パスワードの次にコードを聞かれ、正しいコードで Cookie が出る(途中の札は JS から読めない Cookie)", async () => {
    const res = await post("login", { email, password: PASSWORD });
    expect(await res.json()).toEqual({ next: "mfa" });
    expect(cookie(res, "sid")).toBeUndefined();
    const pending = cookie(res, "mfa");
    expect(pending).toBeDefined();
    expect(res.headers.getSetCookie().find((c) => c.startsWith("mfa="))).toMatch(/HttpOnly/i);

    const done = await post("mfa", { code: totp(secret) }, pending);
    expect(await done.json()).toEqual({ next: "done" });
    expect(cookie(done, "sid")).toBeDefined();
  });

  it("コードが違えば 400 invalid_code。途中の札は1回で消え、もう一度はパスワードから", async () => {
    const res = await post("login", { email, password: PASSWORD });
    const pending = cookie(res, "mfa");
    const wrong = await post("mfa", { code: "000000" }, pending);
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as { error: { code: string } }).error.code).toBe("invalid_code");
    const again = await post("mfa", { code: totp(secret) }, pending);
    expect(again.status).toBe(401);
  });

  it("途中の札が無ければ 401(パスワードを飛ばしてコードだけ送れない)", async () => {
    const res = await post("mfa", { code: totp(secret) });
    expect(res.status).toBe(401);
  });
});

describe("パスワードの再設定", () => {
  it("コードと新しいパスワードで再設定でき、古いパスワードは使えない", async () => {
    const fixture = await createTenantFixture(owner.db, "reset");
    const email = fixture.users.member.email;
    await signUpAndConfirm(email);
    expect(await (await post("forgot-password", { email })).json()).toEqual({ next: "confirm" });
    const code = fake.lastCode(email);
    const reset = await post("reset-password", { email, code, password: "New-Password-777" });
    expect(await reset.json()).toEqual({ next: "login" });
    expect((await post("login", { email, password: PASSWORD })).status).toBe(401);
    expect(await (await post("login", { email, password: "New-Password-777" })).json()).toEqual({
      next: "done",
    });
  });

  it("いない人にも同じ答え(登録の有無が分からない)", async () => {
    const res = await post("forgot-password", { email: `ghost-${Date.now()}@example.test` });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ next: "confirm" });
  });
});

describe("こちらの都合", () => {
  it("Cognito に届かないときは 503(ログインの失敗と混ぜない)", async () => {
    cognitoUp = false;
    try {
      const res = await post("login", { email: acme.users.member.email, password: PASSWORD });
      expect(res.status).toBe(503);
    } finally {
      cognitoUp = true;
    }
  });

  it("ログインの方式は cognito。ログアウトの後はログイン画面。開発用ログインは無い", async () => {
    const body = (await (await call(app, "GET", "/api/auth/options")).json()) as Record<
      string,
      string
    >;
    expect(body).toEqual({ method: "cognito", logoutUrl: "http://localhost:8080/login" });
    expect((await post("dev-login", { email: acme.users.admin.email })).status).toBe(404);
  });

  it("ログの中に、パスワード・メールアドレス・確認コード・トークンが出ない", () => {
    const all = logs.join("\n");
    expect(all).not.toContain(PASSWORD);
    expect(all).not.toContain("Wrong-Password-1");
    expect(all).not.toContain("New-Password-777");
    expect(all).not.toContain(acme.users.member.email);
    expect(all).not.toMatch(/eyJ[\w-]+\.[\w-]+\./);
    expect(all).not.toMatch(/"code":"\d{6}"/);
  });
});

import { FakeCognito, fakeSub } from "@app/fake-cognito";
import { sql } from "drizzle-orm";
import { createLocalJWKSet } from "jose";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { CognitoClient } from "../../src/auth/providers.ts";
import { loadConfig } from "../../src/config.ts";
import { createDb } from "../../src/db/client.ts";
import { createLogger } from "../../src/logger.ts";
import { call, createTenantFixture, type TenantFixture } from "../helpers/fixtures.ts";

// Cognito でのログインの流れを、偽物の Cognito(packages/fake-cognito)と本物の Postgres で通す。
//   画面「ログイン」→ GET /api/auth/login → Cognito の画面 → GET /api/auth/callback → Cookie → GET /api/me
// トークンはサーバーの中だけ: ブラウザが受け取るのは Location と Cookie だけで、本文にトークンは出ない。

const APP_URL = "http://localhost:8080";
const COGNITO = "http://fake-cognito.test";
const env = {
  APP_ENV: "test",
  DATABASE_URL: inject("appUrl"),
  SESSION_SECRET: "test-only-".padEnd(40, "x"),
  AUTH_MODE: "cognito",
  COGNITO_REGION: "ap-northeast-1",
  COGNITO_USER_POOL_ID: "local_fakepool",
  COGNITO_CLIENT_ID: "local-web-client",
  COGNITO_DOMAIN: COGNITO,
  APP_URL,
  COGNITO_ISSUER: `${COGNITO}/local_fakepool`,
};
const config = loadConfig(env);
if (config.auth.mode !== "cognito") throw new Error("cognito で組み立てる");

const fake = new FakeCognito({
  baseUrl: COGNITO,
  userPoolId: "local_fakepool",
  clientId: "local-web-client",
  callbackUrls: [`${APP_URL}/api/auth/callback`],
  logoutUrls: [`${APP_URL}/login`],
});
let cognitoUp = true;
const cognito = new CognitoClient(config.auth, {
  jwks: createLocalJWKSet(fake.jwks as never),
  fetch: (input, init) =>
    cognitoUp
      ? fake.fetch(new Request(input, init))
      : Promise.reject(new TypeError("fetch failed")),
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
let globex: TenantFixture;
beforeAll(async () => {
  acme = await createTenantFixture(owner.db, "acme");
  globex = await createTenantFixture(owner.db, "globex");
});
afterAll(async () => {
  await owner.pool.end();
  await pool.end();
});

/** Set-Cookie から「名前=値」だけを取り出して、ブラウザのように次へ持っていく */
const cookiesOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0] ?? "")
    .filter((c) => !c.endsWith("="))
    .join("; ");

type Choice = { email: string; verified?: boolean; cancel?: boolean };

/** ブラウザがする順番どおりに、ログインを最後まで進める */
async function loginFlow(choice: Choice, opts: { returnTo?: string } = {}) {
  const q = opts.returnTo === undefined ? "" : `?returnTo=${encodeURIComponent(opts.returnTo)}`;
  const start = await call(app, "GET", `/api/auth/login${q}`);
  expect(start.status).toBe(302);
  const pendingCookie = cookiesOf(start);
  const authorize = new URL(start.headers.get("location") ?? "");
  expect(authorize.origin).toBe(COGNITO);

  // Cognito の画面で、人がメールを選んで「ログイン」を押す
  const form = new URLSearchParams(authorize.searchParams);
  form.set("email", choice.email);
  form.set("action", choice.cancel ? "cancel" : "login");
  if (choice.verified !== false) form.set("email_verified", "true");
  const back = await fake.fetch(
    new Request(`${COGNITO}/oauth2/authorize`, { method: "POST", body: form }),
  );
  const callbackUrl = new URL(back.headers.get("location") ?? "");
  expect(callbackUrl.origin + callbackUrl.pathname).toBe(`${APP_URL}/api/auth/callback`);

  const done = await call(app, "GET", callbackUrl.pathname + callbackUrl.search, {
    cookie: pendingCookie,
  });
  return { done, pendingCookie, callbackPath: callbackUrl.pathname + callbackUrl.search };
}

const sessionCookie = (res: Response) =>
  cookiesOf(res)
    .split("; ")
    .find((c) => c.startsWith("sid="));

async function externalIdOf(userId: string) {
  const r = await owner.db.execute<{ external_id: string | null }>(
    sql`select external_id from organizations.users where id = ${userId}`,
  );
  return r.rows[0]?.external_id ?? null;
}

describe("Cognito でのログイン", () => {
  it("初めてのログイン: 確認済みのメールで users の行と結びつき、元の画面へ戻る", async () => {
    const { done } = await loginFlow(
      { email: acme.users.member.email },
      { returnTo: `/projects/${acme.projectId}?status=open` },
    );
    expect(done.status).toBe(302);
    expect(done.headers.get("location")).toBe(`/projects/${acme.projectId}?status=open`);
    const sid = sessionCookie(done);
    expect(sid).toBeDefined();
    // 本文にトークンが出ない(ブラウザに渡すのは Cookie だけ)
    expect(await done.text()).not.toMatch(/eyJ/);

    const me = await call(app, "GET", "/api/me", { cookie: sid });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ role: "member" });
    expect(await externalIdOf(acme.users.member.id)).toBe(fakeSub(acme.users.member.email));
    expect(logs.some((l) => l.includes("結びつけました"))).toBe(true);
  });

  it("2回目からは sub で引く(メールの大文字小文字が違っても同じ人)", async () => {
    await loginFlow({ email: acme.users.admin.email });
    const { done } = await loginFlow({ email: acme.users.admin.email.toUpperCase() });
    expect(done.status).toBe(302);
    const me = await call(app, "GET", "/api/me", { cookie: sessionCookie(done) });
    expect(await me.json()).toMatchObject({ role: "admin" });
  });

  it("別の会社の人は、その会社のテナントでログインする", async () => {
    const { done } = await loginFlow({ email: globex.users.viewer.email });
    const me = await call(app, "GET", "/api/me", { cookie: sessionCookie(done) });
    expect(await me.json()).toMatchObject({ role: "viewer" });
    // 自分の会社のプロジェクトは見えて、他社のは 404
    const sid = sessionCookie(done);
    expect(
      (await call(app, "GET", `/api/projects/${globex.projectId}`, { cookie: sid })).status,
    ).toBe(200);
    expect(
      (await call(app, "GET", `/api/projects/${acme.projectId}`, { cookie: sid })).status,
    ).toBe(404);
  });

  it.each([
    ["users にいない人", { email: "stranger@example.test" }],
    ["確認していないメール", { email: "", verified: false }],
    ["Cognito の画面で「やめる」", { email: "", cancel: true }],
  ])("%s → ログイン画面に「ログインできませんでした」", async (_, choice) => {
    const email = choice.email || acme.users.viewer.email;
    const { done } = await loginFlow({ ...choice, email });
    expect(done.status).toBe(302);
    expect(done.headers.get("location")).toBe("/login?error=login_failed");
    expect(sessionCookie(done)).toBeUndefined();
  });

  it("確認していないメールでは、結びつけない", async () => {
    const fixture = await createTenantFixture(owner.db, "unverified");
    await loginFlow({ email: fixture.users.viewer.email, verified: false });
    expect(await externalIdOf(fixture.users.viewer.id)).toBeNull();
  });

  it("もう別の Cognito アカウントと結びついている行は、メールが同じでも付け替えない", async () => {
    const fixture = await createTenantFixture(owner.db, "taken");
    await owner.db.execute(
      sql`update organizations.users set external_id = 'someone-else' where id = ${fixture.users.admin.id}`,
    );
    const { done } = await loginFlow({ email: fixture.users.admin.email });
    expect(done.headers.get("location")).toBe("/login?error=login_failed");
    expect(await externalIdOf(fixture.users.admin.id)).toBe("someone-else");
  });

  it("途中の状態の Cookie が無い(よそから戻りの URL だけ踏ませた)なら受け付けない", async () => {
    const { callbackPath } = await loginFlowUntilCallback(acme.users.member.email);
    const res = await call(app, "GET", callbackPath);
    expect(res.headers.get("location")).toBe("/login?error=login_failed");
    expect(sessionCookie(res)).toBeUndefined();
  });

  it("state が違えば受け付けない", async () => {
    const { callbackPath, pendingCookie } = await loginFlowUntilCallback(acme.users.member.email);
    const tampered = callbackPath.replace(/state=[^&]+/, "state=forged");
    const res = await call(app, "GET", tampered, { cookie: pendingCookie });
    expect(res.headers.get("location")).toBe("/login?error=login_failed");
  });

  it("同じ戻りの URL を2回使えない(途中の状態も code も1回だけ)", async () => {
    const { callbackPath, pendingCookie } = await loginFlowUntilCallback(acme.users.member.email);
    const first = await call(app, "GET", callbackPath, { cookie: pendingCookie });
    expect(sessionCookie(first)).toBeDefined();
    const second = await call(app, "GET", callbackPath, { cookie: pendingCookie });
    expect(second.headers.get("location")).toBe("/login?error=login_failed");
  });

  it.each([
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example",
    "/api/projects",
    "javascript:alert(1)",
  ])("戻り先 %s は、アプリのトップ(/)にする", async (returnTo) => {
    const { done } = await loginFlow({ email: acme.users.member.email }, { returnTo });
    expect(done.headers.get("location")).toBe("/");
  });

  it("Cognito に届かないときは「止まっています」(ログインの失敗と分ける)", async () => {
    const { callbackPath, pendingCookie } = await loginFlowUntilCallback(acme.users.member.email);
    cognitoUp = false;
    try {
      const res = await call(app, "GET", callbackPath, { cookie: pendingCookie });
      expect(res.headers.get("location")).toBe("/login?error=service_unavailable");
    } finally {
      cognitoUp = true;
    }
  });

  it("ログの中に、メールアドレス・code・トークンが出ない", async () => {
    await loginFlow({ email: "stranger2@example.test" });
    const all = logs.join("\n");
    expect(all).not.toContain("stranger2@example.test");
    expect(all).not.toContain(acme.users.member.email);
    expect(all).not.toMatch(/eyJ[\w-]+\.[\w-]+\./);
    expect(all).not.toMatch(/code=/);
  });

  it("ログインの方式は cognito で、ログアウトの先は Cognito の /logout", async () => {
    const res = await call(app, "GET", "/api/auth/options");
    const body = (await res.json()) as { method: string; logoutUrl: string };
    expect(body.method).toBe("cognito");
    expect(new URL(body.logoutUrl).searchParams.get("logout_uri")).toBe(`${APP_URL}/login`);
    // 開発用ログインは生えていない
    expect(
      (await call(app, "POST", "/api/auth/dev-login", { body: { email: acme.users.admin.email } }))
        .status,
    ).toBe(404);
  });
});

/** Cognito の画面で「ログイン」を押し、API の callback を踏む直前まで進める */
async function loginFlowUntilCallback(email: string) {
  const start = await call(app, "GET", "/api/auth/login");
  const pendingCookie = cookiesOf(start);
  const authorize = new URL(start.headers.get("location") ?? "");
  const form = new URLSearchParams(authorize.searchParams);
  form.set("email", email);
  form.set("action", "login");
  form.set("email_verified", "true");
  const back = await fake.fetch(
    new Request(`${COGNITO}/oauth2/authorize`, { method: "POST", body: form }),
  );
  const url = new URL(back.headers.get("location") ?? "");
  return { pendingCookie, callbackPath: url.pathname + url.search };
}

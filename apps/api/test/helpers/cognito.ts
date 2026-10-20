import { FakeCognito, totp } from "@app/fake-cognito";
import { sql } from "drizzle-orm";
import { createLocalJWKSet } from "jose";
import { expect } from "vitest";
import { createApp } from "../../src/app.ts";
import { CognitoClient } from "../../src/auth/providers.ts";
import { loadConfig } from "../../src/config.ts";
import { createDb, type RootDb } from "../../src/db/client.ts";
import { createLogger } from "../../src/logger.ts";
import type { MailMessage } from "../../src/mail/index.ts";
import { type OutboxEvent, type OutboxTopic, outboxHandlers } from "../../src/outbox/index.ts";
import { call } from "./fixtures.ts";

// 偽物の Cognito でつないだアプリ(結合テスト用)。登録 → 確認 → ログイン(→ 二段階認証)を画面と同じ順で行う。

export const PASSWORD = "Correct-Horse-42";
const COGNITO = "http://fake-cognito.test";
const POOL = "local_fakepool";
const CLIENT = "local-web-client";
const APP_URL = "http://localhost:8080";

export function createCognitoApp(appUrl: string, env: Record<string, string> = {}) {
  const config = loadConfig({
    APP_ENV: "test",
    DATABASE_URL: appUrl,
    SESSION_SECRET: "test-only-".padEnd(40, "x"),
    AUTH_MODE: "cognito",
    COGNITO_REGION: "ap-northeast-1",
    COGNITO_USER_POOL_ID: POOL,
    COGNITO_CLIENT_ID: CLIENT,
    COGNITO_ENDPOINT: COGNITO,
    ...env,
  });
  if (config.auth.mode !== "cognito") throw new Error("cognito で組み立てる");
  const fake = new FakeCognito({ baseUrl: COGNITO, userPoolId: POOL, clientId: CLIENT });
  const cognito = new CognitoClient(config.auth, {
    jwks: createLocalJWKSet(fake.jwks as never),
    fetch: (input, init) => fake.fetch(new Request(input, init)),
  });
  const logs: string[] = [];
  const logger = createLogger({ level: "info", destination: { write: (l) => logs.push(l) } });
  const { db, pool } = createDb(appUrl);
  const app = createApp({ config, db, logger, cognito });
  const sent: MailMessage[] = [];
  const handlers = outboxHandlers({
    db,
    logger,
    mailer: { send: async (m) => void sent.push(m) },
    appUrl: APP_URL,
  });
  return { app, pool, fake, logs, db, handlers, sent };
}

export type CognitoApp = ReturnType<typeof createCognitoApp>;

/** Set-Cookie から「名前=値」だけを取り出す(消す Cookie は除く) */
export const cookieOf = (res: Response, name: string) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0] ?? "")
    .find((c) => c.startsWith(`${name}=`) && !c.endsWith("="));

/** 2つの Cookie を1つの Cookie ヘッダーにする(セッション+確かめ直しの札) */
export const both = (...cookies: (string | undefined)[]) => cookies.filter(Boolean).join("; ");

/** 登録して確認コードを入れる(画面と同じ順) */
export async function signUp(t: CognitoApp, email: string, password = PASSWORD) {
  await call(t.app, "POST", "/api/auth/sign-up", { body: { email, password } });
  const code = t.fake.lastCode(email);
  const res = await call(t.app, "POST", "/api/auth/confirm-sign-up", { body: { email, code } });
  expect(res.status).toBe(200);
}

/** ログインしてセッションの Cookie を返す。secret があれば二段階認証のコードも答える */
export async function logIn(t: CognitoApp, email: string, password = PASSWORD, secret?: string) {
  const res = await call(t.app, "POST", "/api/auth/login", { body: { email, password } });
  expect(res.status).toBe(200);
  const next = ((await res.json()) as { next: string }).next;
  if (next === "done") return cookieOf(res, "sid") ?? "";
  expect(next, "二段階認証のコードを聞かれる").toBe("mfa");
  if (!secret) throw new Error("二段階認証の鍵が要る");
  const done = await call(t.app, "POST", "/api/auth/mfa", {
    body: { code: totp(secret) },
    cookie: cookieOf(res, "mfa"),
  });
  expect(done.status).toBe(200);
  return cookieOf(done, "sid") ?? "";
}

/** パスワードを入れ直して、確かめ直しの札(Cookie)を得る */
export async function reauth(t: CognitoApp, sid: string, password = PASSWORD, secret?: string) {
  const body = secret ? { password, code: totp(secret) } : { password };
  const res = await call(t.app, "POST", "/api/account/reauth", { cookie: sid, body });
  expect(res.status).toBe(200);
  return cookieOf(res, "reauth") ?? "";
}

/** 二段階認証を有効にする。鍵と、この端末の新しいセッションを返す */
export async function enableMfa(t: CognitoApp, sid: string, password = PASSWORD) {
  const ticket = await reauth(t, sid, password);
  const setup = await call(t.app, "POST", "/api/account/mfa/setup", { cookie: both(sid, ticket) });
  expect(setup.status).toBe(200);
  const { secret } = (await setup.json()) as { secret: string };
  const res = await call(t.app, "POST", "/api/account/mfa/enable", {
    cookie: both(sid, ticket),
    body: { code: totp(secret) },
  });
  expect(res.status).toBe(204);
  return { secret, sid: cookieOf(res, "sid") ?? "" };
}

/** 積まれた出来事(その組織・その種類)を、表の持ち主の接続で読む */
export async function eventsOf(owner: RootDb, tenantId: string, topic: OutboxTopic) {
  const r = await owner.execute<{ id: string; payload: unknown; created_at: Date }>(
    sql`select id, payload, created_at from platform.outbox where tenant_id = ${tenantId} and topic = ${topic} order by created_at`,
  );
  return r.rows.map(
    (row): OutboxEvent => ({
      id: row.id,
      tenantId,
      topic,
      payload: row.payload,
      attempts: 0,
      createdAt: row.created_at,
    }),
  );
}

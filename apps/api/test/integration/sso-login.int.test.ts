import type { AuditEventPage } from "@app/shared";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../../src/db/client.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { domains, users } from "../../src/domains/organizations/schema.ts";
import { providerNameFor } from "../../src/sso/connect.ts";
import { cookieOf } from "../helpers/cognito.ts";
import { call } from "../helpers/fixtures.ts";
import {
  APP_URL,
  createSsoContext,
  enterprise,
  OAUTH,
  type SsoContext,
  ssoLogin,
  ssoTenant,
  startSso,
} from "../helpers/sso.ts";

// 大きなお客さん向けの守りの段1b(docs/specs/0056-sso-scim-ip-audit-export.md・設計書 0056 の 0・6)の受け入れ条件のうち、
// SSO のログインの流れ: メールで IdP へ回り、戻るとその組織に入る(パスワードは入れない)・その IdP の組織の、
// 確かめたドメインの人だけ・いない人は入れない(JIT なし)。必須・緊急用・運営のコマンドは sso-required.int.test.ts。
// 偽物の Cognito の OAuth の入口と「テスト用の IdP」を使う(本物の SAML は stg で人が確かめる。設計書 0056 の U-8)。

const owner = createDb(inject("ownerUrl"));
let ctx: SsoContext;

beforeAll(async () => {
  ctx = await createSsoContext(inject("appUrl"), owner.db);
});
afterAll(async () => {
  await ctx.close();
  await owner.pool.end();
});

const me = (sid: string | undefined) => call(ctx.t.app, "GET", "/api/me", { cookie: sid });
const FAILED = `${APP_URL}/login?sso=failed`;

describe("SSO の開始", () => {
  it("確かめたドメインに IdP をつないだ組織なら、IdP を名指しした Cognito の入口へ。ほかはパスワードへ", async () => {
    const a = await ssoTenant(ctx);
    const { body, cookie } = await startSso(ctx, a.users.member.email);
    expect(body.next).toBe("redirect");
    const url = new URL((body as { url: string }).url);
    expect(url.origin + url.pathname).toBe(`${OAUTH}/oauth2/authorize`);
    expect(url.searchParams.get("identity_provider")).toBe(providerNameFor(a.tenantId));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(`${APP_URL}/api/auth/sso/callback`);
    expect(cookie, "途中の状態は HttpOnly の Cookie").toBeTruthy();

    // つないでいないドメイン・まだ確かめていないドメインは、人がいてもいなくても同じ答え
    expect((await startSso(ctx, "someone@nowhere.test")).body).toEqual({ next: "password" });
    await withTenant(owner.db, a.tenantId, (tx) =>
      tx.insert(domains).values({
        id: uuidv7(),
        tenantId: a.tenantId,
        domain: `unverified-${a.domain}`,
        verifyToken: "t",
        createdBy: a.users.admin.id,
      }),
    );
    expect((await startSso(ctx, `x@unverified-${a.domain}`)).body).toEqual({ next: "password" });
  });
});

describe("SSO の戻り", () => {
  it("IdP から戻ると、その組織に SSO の印つきで入る(パスワードを入れない)。監査ログに via: sso", async () => {
    const a = await ssoTenant(ctx);
    const { location, sid } = await ssoLogin(ctx, a.users.member.email);
    expect(location).toBe(`${APP_URL}/`);
    const res = await me(sid);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { tenantId: string }).tenantId).toBe(a.tenantId);

    const admin = (await ssoLogin(ctx, a.users.admin.email)).sid;
    const audit = await call(ctx.t.app, "GET", "/api/audit-events?limit=100", { cookie: admin });
    const logins = ((await audit.json()) as AuditEventPage).events.filter(
      (e) => e.action === "auth.login",
    );
    expect(logins.length).toBeGreaterThanOrEqual(2);
    expect(logins.every((e) => (e.details as { via?: string } | null)?.via === "sso")).toBe(true);
  });

  it("state が違う・コードを使い回す・Cookie が無い、はログインの画面へ戻す(理由は言わない)", async () => {
    const a = await ssoTenant(ctx);
    const { body, cookie } = await startSso(ctx, a.users.member.email);
    const authorize = (body as { url: string }).url;
    const code = ctx.t.fake.issueSsoCode(authorize, a.users.member.email);
    const state = new URL(authorize).searchParams.get("state") ?? "";
    const back = (q: string, c?: string) =>
      call(ctx.t.app, "GET", `/api/auth/sso/callback?${q}`, { cookie: c });

    const wrongState = await back(`code=${code}&state=other`, cookie);
    expect(wrongState.headers.get("location")).toBe(FAILED);
    expect(cookieOf(wrongState, "sid")).toBeUndefined();
    // Cookie は1回で消える。コードが正しくても、途中の状態が無ければ入れない
    expect((await back(`code=${code}&state=${state}`)).headers.get("location")).toBe(FAILED);
    expect((await back("error=access_denied", cookie)).headers.get("location")).toBe(FAILED);
  });

  it("その組織にいない人(JIT はしない)・確かめたドメインの外のメール・他社の IdP の主張は入れない", async () => {
    const a = await ssoTenant(ctx);
    const b = await ssoTenant(ctx);
    const member = a.users.member.email;
    // a の IdP が、a のドメインのいない人を返した
    expect((await ssoLogin(ctx, member, `ghost@${a.domain}`)).location).toBe(FAILED);
    // a の IdP が、b のドメインの人(b にはいる)を名乗った
    expect((await ssoLogin(ctx, member, b.users.member.email)).location).toBe(FAILED);
    // a の IdP が、a の組織にいるがドメインの外の人(取引先)を返した
    const guest = `guest-${uuidv7().slice(-6)}@partner.test`;
    await withTenant(owner.db, a.tenantId, (tx) =>
      tx.insert(users).values({
        id: uuidv7(),
        tenantId: a.tenantId,
        email: guest,
        name: "取引先",
        role: "member",
      }),
    );
    expect((await ssoLogin(ctx, member, guest)).location).toBe(FAILED);
  });

  it("プランから sso が外れた組織には、SSO で入れない", async () => {
    const a = await ssoTenant(ctx);
    await enterprise(ctx, a.tenantId, "standard");
    expect((await ssoLogin(ctx, a.users.member.email)).location).toBe(FAILED);
  });
});

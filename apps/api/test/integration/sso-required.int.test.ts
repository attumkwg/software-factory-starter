import type { AuditEventPage, SsoSettings } from "@app/shared";
import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../../src/db/client.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { users } from "../../src/domains/organizations/schema.ts";
import { connectSso, disconnectSso } from "../../src/sso/connect.ts";
import { logIn, PASSWORD, signUp } from "../helpers/cognito.ts";
import { call, createTenantFixture } from "../helpers/fixtures.ts";
import {
  codeOf,
  createSsoContext,
  METADATA,
  type SsoContext,
  ssoLogin,
  ssoTenant,
  startSso,
} from "../helpers/sso.ts";

// 大きなお客さん向けの守りの段1b(docs/specs/0056-sso-scim-ip-audit-export.md・設計書 0056 の 4・6)の受け入れ条件のうち、
// SSO の必須と緊急用・組織の切り替え・変更の監査ログ・運営のコマンド。ログインの流れは sso-login.int.test.ts。

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
const putSso = (cookie: string, body: { required: boolean; exemptUserIds: string[] }) =>
  call(ctx.t.app, "PUT", "/api/organization/sso", { cookie, body });

/** SSO の組織で、管理者を緊急用にして必須にする。管理者の SSO のセッションを返す */
async function requireSso(a: Awaited<ReturnType<typeof ssoTenant>>) {
  const admin = (await ssoLogin(ctx, a.users.admin.email)).sid ?? "";
  const res = await putSso(admin, { required: true, exemptUserIds: [a.users.admin.id] });
  expect(res.status).toBe(200);
  return admin;
}

describe("SSO の必須と緊急用", () => {
  it("必須には緊急用が1人以上要る(409)。緊急用は管理者だけ・2人まで(400)。変更は監査ログに", async () => {
    const a = await ssoTenant(ctx);
    const admin = (await ssoLogin(ctx, a.users.admin.email)).sid ?? "";
    expect(await codeOf(await putSso(admin, { required: true, exemptUserIds: [] }))).toBe(
      "sso_exempt_required",
    );
    const member = await putSso(admin, { required: true, exemptUserIds: [a.users.member.id] });
    expect(member.status).toBe(400);
    const ok = await putSso(admin, { required: true, exemptUserIds: [a.users.admin.id] });
    expect(ok.status).toBe(200);
    expect((await ok.json()) as SsoSettings).toEqual({
      connected: true,
      required: true,
      exemptUserIds: [a.users.admin.id],
    });
    const audit = await call(ctx.t.app, "GET", "/api/audit-events?limit=100", { cookie: admin });
    const actions = ((await audit.json()) as AuditEventPage).events.map((e) => e.action);
    expect(actions).toContain("sso.update");
    expect(actions).toContain("sso.connect");
  });

  it("必須の組織では、そのドメインの人はパスワードで入れない(403 sso_required)。前からのセッションも止まる", async () => {
    const a = await ssoTenant(ctx);
    await signUp(ctx.t, a.users.member.email);
    const before = await logIn(ctx.t, a.users.member.email);
    expect((await me(before)).status).toBe(200);

    await requireSso(a);
    const refused = await call(ctx.t.app, "POST", "/api/auth/login", {
      body: { email: a.users.member.email, password: PASSWORD },
    });
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe("sso_required");
    expect(await codeOf(await me(before))).toBe("sso_required");
    // SSO で入れば通る
    expect((await me((await ssoLogin(ctx, a.users.member.email)).sid)).status).toBe(200);
  });

  it("緊急用の管理者はパスワードで入れるが、二段階認証の設定が要る。SSO で入った人には二段階認証の必須を当てない", async () => {
    const a = await ssoTenant(ctx);
    const admin = await requireSso(a);
    await signUp(ctx.t, a.users.admin.email);
    const emergency = await logIn(ctx.t, a.users.admin.email);
    const projects = await call(ctx.t.app, "GET", "/api/projects", { cookie: emergency });
    expect(projects.status).toBe(403);
    expect(await codeOf(projects)).toBe("mfa_setup_required");
    // 画面が設定へ回せるように、/api/me も設定待ちと言う
    const mine = (await (await me(emergency)).json()) as { mfa: { setupRequired: boolean } };
    expect(mine.mfa.setupRequired).toBe(true);
    // SSO で入った同じ人は、二段階認証を求められない(IdP の役目)
    expect((await call(ctx.t.app, "GET", "/api/projects", { cookie: admin })).status).toBe(200);
  });

  it("2つの組織にいる人は、パスワードでは必須でない組織に入り、必須の組織への切り替えは 403 sso_required", async () => {
    const a = await ssoTenant(ctx);
    const b = await createTenantFixture(owner.db, `plain-${uuidv7().slice(-6)}`);
    // a のメンバーを b にも足す(1人が複数の組織に)
    await withTenant(owner.db, b.tenantId, (tx) =>
      tx.insert(users).values({
        id: uuidv7(),
        tenantId: b.tenantId,
        email: a.users.member.email,
        name: "兼務",
        role: "member",
      }),
    );
    await requireSso(a);
    await signUp(ctx.t, a.users.member.email);
    const sid = await logIn(ctx.t, a.users.member.email);
    const res = await me(sid);
    expect(((await res.json()) as { tenantId: string }).tenantId).toBe(b.tenantId);
    const sw = await call(ctx.t.app, "POST", "/api/session/organization", {
      cookie: sid,
      body: { tenantId: a.tenantId },
    });
    expect(sw.status).toBe(403);
    expect(await codeOf(sw)).toBe("sso_required");
  });
});

describe("運営のコマンド sso-connect・sso-disconnect", () => {
  it("確かめたドメインが無い組織にはつながない。試しは何も変えず、外すと SSO はパスワードへ戻る", async () => {
    const bare = await createTenantFixture(owner.db, `bare-${uuidv7().slice(-6)}`);
    const plan = (tenantId: string) =>
      connectSso(owner.db, ctx.cognito, { tenantId, metadataUrl: METADATA, execute: false });
    await expect(plan(bare.tenantId)).rejects.toThrow(/確かめたドメイン/);

    const a = await ssoTenant(ctx);
    await expect(plan(a.tenantId)).rejects.toThrow(/もうつないで/);
    const trial = await disconnectSso(owner.db, ctx.cognito, {
      tenantId: a.tenantId,
      execute: false,
    });
    expect(trial.mode).toBe("plan");
    expect((await startSso(ctx, a.users.member.email)).body.next).toBe("redirect");

    const done = await disconnectSso(owner.db, ctx.cognito, {
      tenantId: a.tenantId,
      execute: true,
    });
    expect(done.mode).toBe("disconnected");
    expect((await startSso(ctx, a.users.member.email)).body).toEqual({ next: "password" });
    const left = await owner.db.execute<{ n: number }>(
      sql`select count(*)::integer as n from organizations.sso_connections where tenant_id = ${a.tenantId}`,
    );
    expect(left.rows[0]?.n).toBe(0);
  });
});

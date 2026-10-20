import type { AuditEventPage, CreatedSupportGrant, Me, MfaRequirement } from "@app/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { createDb } from "../../src/db/client.ts";
import { tenants } from "../../src/db/schema.ts";
import { withTenant } from "../../src/db/tenant.ts";
import {
  cookieOf,
  createCognitoApp,
  enableMfa,
  logIn,
  PASSWORD,
  signUp,
} from "../helpers/cognito.ts";
import { call, createTenantFixture, type TenantFixture } from "../helpers/fixtures.ts";

// 組織の二段階認証の必須と、サポートの代理ログイン(docs/specs/0006-account-security.md)。
// 2つの組織: acme(お客さん)・ops(運営。SUPPORT_TENANT_ID。種データと同じく最初から必須)

const owner = createDb(inject("ownerUrl"));
let acme: TenantFixture;
let ops: TenantFixture;
let t: ReturnType<typeof createCognitoApp>;
/** acme の管理者の二段階認証の鍵(最初の describe で有効にする) */
let adminSecret = "";

const get = (path: string, cookie: string) => call(t.app, "GET", `/api${path}`, { cookie });
const send = (method: string, path: string, cookie: string, body?: unknown) =>
  call(t.app, method, `/api${path}`, { cookie, body });
const codeOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;
const setRequired = (tenantId: string, required: boolean) =>
  withTenant(owner.db, tenantId, (tx) =>
    tx.update(tenants).set({ mfaRequired: required }).where(eq(tenants.tenantId, tenantId)),
  );

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
  acme = await createTenantFixture(owner.db, "acme");
  ops = await createTenantFixture(owner.db, "ops");
  await setRequired(ops.tenantId, true);
  t = createCognitoApp(inject("appUrl"), { SUPPORT_TENANT_ID: ops.tenantId });
  for (const f of [acme, ops]) for (const u of Object.values(f.users)) await signUp(t, u.email);
});
afterAll(async () => {
  vi.useRealTimers();
  await owner.pool.end();
  await t.pool.end();
});

describe("組織の管理者が、全員に二段階認証を必須にする", () => {
  let admin: string;
  let viewer: string;

  it("自分が未設定の管理者は入れられない(409)。設定すれば入れられ、未設定の人数が分かる", async () => {
    viewer = await logIn(t, acme.users.viewer.email);
    admin = await logIn(t, acme.users.admin.email);
    expect(await codeOf(await send("POST", "/organization/mfa-requirement", admin))).toBe(
      "mfa_not_enabled",
    );
    ({ sid: admin, secret: adminSecret } = await enableMfa(t, admin));
    expect((await send("POST", "/organization/mfa-requirement", admin)).status).toBe(204);
    const state = (await (
      await get("/organization/mfa-requirement", admin)
    ).json()) as MfaRequirement;
    expect(state).toEqual({ required: true, usersWithoutMfa: 2 });
    const audit = (await (await get("/audit-events?limit=100", admin)).json()) as AuditEventPage;
    expect(audit.events.map((e) => e.action)).toContain("organization.mfa_require");
  });

  it("未設定の人は、すでにログインしていても次の操作から 403 mfa_setup_required。設定の API だけ通る", async () => {
    expect(await codeOf(await get("/projects", viewer))).toBe("mfa_setup_required");
    const me = (await (await get("/me", viewer)).json()) as Me;
    expect(me.mfa).toEqual({ enabled: false, required: true, setupRequired: true });
    expect((await get("/account", viewer)).status).toBe(200);
    const pw = await send("POST", "/account/password", viewer, {
      currentPassword: PASSWORD,
      newPassword: "New-Password-777",
    });
    expect(await codeOf(pw)).toBe("mfa_setup_required");
    ({ sid: viewer } = await enableMfa(t, viewer));
    expect((await get("/projects", viewer)).status).toBe(200);
  });

  it("必須の間は二段階認証を外せない(403)", async () => {
    const off = await send("POST", "/account/mfa/disable", viewer, {
      password: PASSWORD,
      code: "000000",
    });
    expect(await codeOf(off)).toBe("mfa_required_by_organization");
  });

  it("メンバー・閲覧者は必須の設定を見る・変えることができない", async () => {
    expect((await get("/organization/mfa-requirement", viewer)).status).toBe(403);
    expect((await send("DELETE", "/organization/mfa-requirement", viewer)).status).toBe(403);
  });

  it("切ればすぐ効く(未設定のメンバーも使える)", async () => {
    expect((await send("DELETE", "/organization/mfa-requirement", admin)).status).toBe(204);
    const member = await logIn(t, acme.users.member.email);
    expect((await get("/projects", member)).status).toBe(200);
  });
});

describe("運営の組織とサポートの代理ログイン", () => {
  let code: string;

  it("運営の組織は必須で、切れない(409)", async () => {
    let opsAdmin = await logIn(t, ops.users.admin.email);
    expect(await codeOf(await get("/projects", opsAdmin))).toBe("mfa_setup_required");
    ({ sid: opsAdmin } = await enableMfa(t, opsAdmin));
    expect(await codeOf(await send("DELETE", "/organization/mfa-requirement", opsAdmin))).toBe(
      "support_org_requires_mfa",
    );
  });

  it("二段階認証が未設定の社員は、代理で入れない", async () => {
    const acmeAdmin = await logIn(t, acme.users.admin.email, PASSWORD, adminSecret);
    const grant = await send("POST", "/support-grants", acmeAdmin, { hours: 24 });
    ({ code } = (await grant.json()) as CreatedSupportGrant);
    await send("POST", "/organization/mfa-requirement", acmeAdmin);

    const staff = await logIn(t, ops.users.member.email);
    // 運営の組織が必須なので、まず設定待ちで止まる
    expect(await codeOf(await send("POST", "/support/sessions", staff, { code }))).toBe(
      "mfa_setup_required",
    );
    // 運営の組織の必須が何かの理由で外れていても、必須のお客さんには入れない(二重の守り)
    await setRequired(ops.tenantId, false);
    expect(await codeOf(await send("POST", "/support/sessions", staff, { code }))).toBe(
      "mfa_required_for_support",
    );
    await setRequired(ops.tenantId, true);
  });

  it("設定済みの社員は入れる。代理の最中は、自分のアカウントも組織の必須も変えられない", async () => {
    const { sid: staff } = await enableMfa(t, await logIn(t, ops.users.member.email));
    const entered = await send("POST", "/support/sessions", staff, { code });
    expect(entered.status).toBe(201);
    const acting = cookieOf(entered, "sid") ?? "";
    expect((await get("/projects", acting)).status).toBe(200);
    expect((await get("/account", acting)).status).toBe(403);
    expect((await send("POST", "/account/reauth", acting, { password: PASSWORD })).status).toBe(
      403,
    );
    expect((await get("/organization/mfa-requirement", acting)).status).toBe(403);
    expect((await send("DELETE", "/organization/mfa-requirement", acting)).status).toBe(403);
  });
});

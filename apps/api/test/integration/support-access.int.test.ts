import type { AuditEventPage, CreatedSupportGrant, Me, SupportSession } from "@app/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../../src/db/client.ts";
import { supportGrants, users } from "../../src/db/schema.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { generateSupportCode, hashSupportCode } from "../../src/domains/organizations/support.ts";
import {
  call,
  createTenantFixture,
  createTestApp,
  login,
  type TenantFixture,
} from "../helpers/fixtures.ts";

// サポートの代理ログイン(docs/specs/0004-support-access.md)の受け入れ条件。
// 3つの組織: a(お客さん)・b(別のお客さん)・ops(運営。SUPPORT_TENANT_ID)

const owner = createDb(inject("ownerUrl"));
let a: TenantFixture;
let b: TenantFixture;
let ops: TenantFixture;
let app: ReturnType<typeof createTestApp>["app"];
let pool: ReturnType<typeof createTestApp>["pool"];

const cookieOf = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? "";

async function grant(adminCookie: string, hours = 24) {
  const res = await call(app, "POST", "/api/support-grants", {
    cookie: adminCookie,
    body: { hours },
  });
  expect(res.status).toBe(201);
  return (await res.json()) as CreatedSupportGrant;
}

async function enter(staffCookie: string, code: string) {
  const res = await call(app, "POST", "/api/support/sessions", {
    cookie: staffCookie,
    body: { code },
  });
  return { res, cookie: cookieOf(res) };
}

async function auditOf(adminCookie: string) {
  const res = await call(app, "GET", "/api/audit-events?limit=100", { cookie: adminCookie });
  return ((await res.json()) as AuditEventPage).events;
}

beforeAll(async () => {
  a = await createTenantFixture(owner.db, "acme");
  b = await createTenantFixture(owner.db, "globex");
  ops = await createTenantFixture(owner.db, "ops");
  ({ app, pool } = createTestApp(inject("appUrl"), { SUPPORT_TENANT_ID: ops.tenantId }));
});
afterAll(async () => {
  await owner.pool.end();
  await pool.end();
});

describe("お客さんの管理者が許可する", () => {
  it("番号は作ったときにだけ出て、一覧には出ない", async () => {
    const aAdmin = await login(app, a.users.admin.email);
    const g = await grant(aAdmin, 1);
    expect(g.code).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
    expect(g.status).toBe("active");
    const res = await call(app, "GET", "/api/support-grants", { cookie: aAdmin });
    const text = await res.text();
    expect(text).toContain(g.id);
    expect(text).not.toContain(g.code);
  });
});

describe("社員が番号で入る", () => {
  let aAdmin: string;
  let staff: string;
  let code: string;
  let grantId: string;
  let support: string;

  beforeAll(async () => {
    aAdmin = await login(app, a.users.admin.email);
    staff = await login(app, ops.users.member.email);
    ({ code, id: grantId } = await grant(aAdmin));
    const entered = await enter(staff, code.toLowerCase().replaceAll("-", " "));
    expect(entered.res.status).toBe(201);
    const body = (await entered.res.json()) as SupportSession;
    expect(body.tenantName).toContain("acme");
    expect(new Date(body.expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 60 * 60 * 1000);
    support = entered.cookie;
  });

  it("その組織を閲覧者として見る(自分は社員・代理の期限つき)", async () => {
    const me = (await (await call(app, "GET", "/api/me", { cookie: support })).json()) as Me;
    expect(me).toMatchObject({
      tenantId: a.tenantId,
      userId: ops.users.member.id,
      role: "viewer",
      support: { expiresAt: expect.any(String) },
    });
    const list = await call(app, "GET", "/api/projects", { cookie: support });
    expect(JSON.stringify(await list.json())).toContain(a.projectId);
  });

  it("ほかの組織の物は見えない(404)", async () => {
    const res = await call(app, "GET", `/api/projects/${b.projectId}`, { cookie: support });
    expect(res.status).toBe(404);
  });

  it("書き込みはできない(403)。管理者向けの API も使えない", async () => {
    const res = await call(app, "POST", "/api/projects", {
      cookie: support,
      body: { name: "社員が作ろうとした" },
    });
    expect(res.status).toBe(403);
    expect((await call(app, "GET", "/api/support-grants", { cookie: support })).status).toBe(403);
    expect((await call(app, "GET", "/api/audit-events", { cookie: support })).status).toBe(403);
  });

  it("お客さんの代わりに規約に同意できない(403)。規約の関所の対象外(me に legal が無い)", async () => {
    // docs/specs/0009-legal-consent.md: 代理の社員は見るだけ。NOT_DURING_SUPPORT
    const res = await call(app, "POST", "/api/legal/consents", {
      cookie: support,
      body: { consents: [{ document: "terms", version: 1 }] },
    });
    expect(res.status).toBe(403);
    const me = (await (await call(app, "GET", "/api/me", { cookie: support })).json()) as Me;
    expect(me.legal).toBeUndefined();
  });

  it("入った・見た・拒否が、お客さんの監査ログに「サポート」として残る", async () => {
    await call(app, "GET", `/api/projects/${a.projectId}`, { cookie: support });
    const events = await auditOf(aAdmin);
    const bySupport = events.filter((e) => e.actor.kind === "support");
    expect(bySupport.every((e) => e.actor.id === ops.users.member.id)).toBe(true);
    const actions = bySupport.map((e) => e.action);
    expect(actions).toContain("support.start");
    expect(bySupport).toContainEqual(
      expect.objectContaining({
        action: "support.read",
        target: { type: "project", id: a.projectId },
        details: { route: "GET /api/projects/{projectId}" },
      }),
    );
    expect(bySupport).toContainEqual(
      expect.objectContaining({ action: "project.create", outcome: "denied" }),
    );
    // 他社(b)の記録には何も出ない
    const bAdmin = await login(app, b.users.admin.email);
    expect((await auditOf(bAdmin)).some((e) => e.actor.kind === "support")).toBe(false);
  });

  it("運営の組織の記録にも、入ったことが残る", async () => {
    const opsAdmin = await login(app, ops.users.admin.email);
    const events = await auditOf(opsAdmin);
    expect(events).toContainEqual(
      expect.objectContaining({
        action: "support.start",
        actor: expect.objectContaining({ id: ops.users.member.id }),
      }),
    );
  });

  it("お客さんが取り消すと、次のリクエストから入れず、社員は本来の組織に戻る", async () => {
    expect(
      (await call(app, "DELETE", `/api/support-grants/${grantId}`, { cookie: aAdmin })).status,
    ).toBe(204);
    const res = await call(app, "GET", "/api/projects", { cookie: support });
    expect(res.status).toBe(401);
    const home = cookieOf(res);
    const me = (await (await call(app, "GET", "/api/me", { cookie: home })).json()) as Me;
    expect(me).toMatchObject({ tenantId: ops.tenantId, isSupportStaff: true });
    expect(me.support).toBeUndefined();
    // 取り消した許可の番号では、もう入れない
    expect((await enter(staff, code)).res.status).toBe(400);
  });
});

describe("社員でなくなったら", () => {
  it("代理の最中でも、運営の組織から外された次のリクエストで止まる", async () => {
    // 運営の組織に、一時的な社員を1人足す
    const tempId = crypto.randomUUID();
    await withTenant(owner.db, ops.tenantId, (tx) =>
      tx.insert(users).values({
        id: tempId,
        tenantId: ops.tenantId,
        email: `temp-${tempId.slice(-12)}@ops.test`,
        name: "一時の社員",
        role: "member",
      }),
    );
    const aAdmin = await login(app, a.users.admin.email);
    const temp = await login(app, `temp-${tempId.slice(-12)}@ops.test`);
    const { cookie } = await enter(temp, (await grant(aAdmin)).code);
    expect((await call(app, "GET", "/api/projects", { cookie })).status).toBe(200);
    // 外す(ロールを閲覧者にする = 社員として使えない)
    await withTenant(owner.db, ops.tenantId, (tx) =>
      tx.update(users).set({ role: "viewer" }).where(eq(users.id, tempId)),
    );
    expect((await call(app, "GET", "/api/projects", { cookie })).status).toBe(401);
  });
});

describe("入れない人・番号", () => {
  it("運営の組織の人でなければ、番号が正しくても入れない(403)", async () => {
    const aAdmin = await login(app, a.users.admin.email);
    const { code } = await grant(aAdmin);
    const bAdmin = await login(app, b.users.admin.email);
    expect((await enter(bAdmin, code)).res.status).toBe(403);
  });

  it("違う番号・期限切れは、どちらも同じ 400(どれかは言わない)", async () => {
    const staff = await login(app, ops.users.admin.email);
    const expired = generateSupportCode();
    await withTenant(owner.db, a.tenantId, (tx) =>
      tx.insert(supportGrants).values({
        tenantId: a.tenantId,
        grantedBy: a.users.admin.id,
        codeHash: hashSupportCode(expired),
        expiresAt: new Date(Date.now() - 1000),
      }),
    );
    const wrong = await enter(staff, "ZZZZ-ZZZZ-ZZZZ");
    const old = await enter(staff, expired);
    expect(wrong.res.status).toBe(400);
    expect(old.res.status).toBe(400);
    type Err = { error: { code: string; message: string } };
    const w = (await wrong.res.json()) as Err;
    const o = (await old.res.json()) as Err;
    expect(w.error.code).toBe("invalid_code");
    expect(o.error).toEqual({ ...w.error, requestId: expect.any(String) });
  });
});

describe("終わり方", () => {
  it("自分で終えると本来の組織に戻り、「出た」が残る。ログアウトでも同じ", async () => {
    const aAdmin = await login(app, a.users.admin.email);
    const staff = await login(app, ops.users.member.email);
    const first = await enter(staff, (await grant(aAdmin)).code);
    const ended = await call(app, "POST", "/api/support/end", { cookie: first.cookie });
    expect(ended.status).toBe(204);
    const me = (await (
      await call(app, "GET", "/api/me", { cookie: cookieOf(ended) })
    ).json()) as Me;
    expect(me.tenantId).toBe(ops.tenantId);
    // 終えた入室の Cookie はもう使えない
    expect((await call(app, "GET", "/api/projects", { cookie: first.cookie })).status).toBe(401);

    const second = await enter(staff, (await grant(aAdmin)).code);
    await call(app, "POST", "/api/auth/logout", { cookie: second.cookie });
    expect((await call(app, "GET", "/api/projects", { cookie: second.cookie })).status).toBe(401);

    const ends = (await auditOf(aAdmin)).filter((e) => e.action === "support.end");
    expect(ends.length).toBeGreaterThanOrEqual(2);
    expect(ends.every((e) => e.actor.kind === "support")).toBe(true);
  });
});

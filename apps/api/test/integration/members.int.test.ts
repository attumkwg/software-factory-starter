import type { AuditEventPage, OrganizationMember, OrganizationPlan } from "@app/shared";
import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../../src/db/client.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { findContact, listUserIds } from "../../src/domains/organizations/index.ts";
import {
  domains,
  scimTokens,
  ssoConnections,
  users,
} from "../../src/domains/organizations/schema.ts";
import {
  call,
  createTenantFixture,
  createTestApp,
  login,
  type TenantFixture,
} from "../helpers/fixtures.ts";

// 組織の人(docs/specs/0079-member-admin.md)の受け入れ条件: 止める(外す)・戻す・ロールを変える。
// 一覧と強制ログアウトは organization-domains.int.test.ts、権限の表の全行は authz-matrix.int.test.ts。

const owner = createDb(inject("ownerUrl"));
const { app, pool } = createTestApp(inject("appUrl"));

afterAll(async () => {
  await owner.pool.end();
  await pool.end();
});

const me = (cookie: string) => call(app, "GET", "/api/me", { cookie });
const disable = (cookie: string, id: string) =>
  call(app, "POST", `/api/organization/members/${id}/disable`, { cookie });
const enable = (cookie: string, id: string) =>
  call(app, "POST", `/api/organization/members/${id}/enable`, { cookie });
const changeRole = (cookie: string, id: string, role: string) =>
  call(app, "PUT", `/api/organization/members/${id}/role`, { cookie, body: { role } });

async function codeOf(res: Response) {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

async function seats(cookie: string) {
  const res = await call(app, "GET", "/api/organization/plan", { cookie });
  expect(res.status).toBe(200);
  return ((await res.json()) as OrganizationPlan).members;
}

async function auditActions(cookie: string) {
  const res = await call(app, "GET", "/api/audit-events?limit=100", { cookie });
  expect(res.status).toBe(200);
  return ((await res.json()) as AuditEventPage).events.map((e) => ({
    action: e.action,
    outcome: e.outcome,
  }));
}

/** もう1人の管理者を足す(同意済みにはしないので、ログインはしない人) */
async function addAdmin(t: TenantFixture, label: string) {
  const id = uuidv7();
  await withTenant(owner.db, t.tenantId, (tx) =>
    tx.insert(users).values({
      id,
      tenantId: t.tenantId,
      email: `${label}-${t.tenantId.slice(-12)}@members.test`,
      name: label,
      role: "admin",
    }),
  );
  return id;
}

describe("止める(外す)・戻す", () => {
  it("止めると、その人は次のリクエストから入れず、ログインもできず、人数から外れる。行と作った物は残り、戻せば入れる", async () => {
    const t = await createTenantFixture(owner.db, "members");
    const admin = await login(app, t.users.admin.email);
    const member = await login(app, t.users.member.email);
    expect(await seats(admin)).toBe(3);

    const res = await disable(admin, t.users.member.id);
    expect(res.status).toBe(200);
    const stopped = (await res.json()) as OrganizationMember;
    expect(stopped).toMatchObject({ id: t.users.member.id, role: "member" });
    expect(stopped.disabledAt).not.toBeNull();

    expect((await me(member)).status).toBe(401);
    await expect(login(app, t.users.member.email)).rejects.toThrow();
    expect(await seats(admin)).toBe(2);
    // 止めた人にはメールを送らない(タスクの完了・規約の変更のお知らせ)
    await withTenant(owner.db, t.tenantId, async (tx) => {
      expect(await findContact(tx, t.tenantId, t.users.member.id)).toBeNull();
      expect(await listUserIds(tx, t.tenantId)).not.toContain(t.users.member.id);
    });
    // 一覧には残る(戻せるように)
    const list = await call(app, "GET", "/api/organization/members?limit=100", { cookie: admin });
    const listed = ((await list.json()) as { members: OrganizationMember[] }).members;
    expect(listed.find((m) => m.id === t.users.member.id)?.disabledAt).not.toBeNull();

    // もう一度止めても変わらない
    expect((await disable(admin, t.users.member.id)).status).toBe(200);

    const back = await enable(admin, t.users.member.id);
    expect(back.status).toBe(200);
    expect(((await back.json()) as OrganizationMember).disabledAt).toBeNull();
    const again = await login(app, t.users.member.email);
    expect((await me(again)).status).toBe(200);
    expect(await seats(admin)).toBe(3);

    expect(await auditActions(admin)).toEqual(
      expect.arrayContaining([
        { action: "member.disable", outcome: "allowed" },
        { action: "member.enable", outcome: "allowed" },
      ]),
    );
  });

  it("自分は止められない・ロールも変えられない(409)。他社の人は 404", async () => {
    const t = await createTenantFixture(owner.db, "members-self");
    const other = await createTenantFixture(owner.db, "members-other");
    const admin = await login(app, t.users.admin.email);
    expect(await codeOf(await disable(admin, t.users.admin.id))).toBe("cannot_change_yourself");
    expect(await codeOf(await changeRole(admin, t.users.admin.id, "member"))).toBe(
      "cannot_change_yourself",
    );
    expect((await disable(admin, other.users.member.id)).status).toBe(404);
    expect((await changeRole(admin, other.users.admin.id, "viewer")).status).toBe(404);
    expect((await enable(admin, other.users.member.id)).status).toBe(404);
  });
});

describe("ロールを変える", () => {
  it("変えると次のリクエストから効く(メンバー → 閲覧者は書けない・閲覧者 → 管理者は監査ログを読める)", async () => {
    const t = await createTenantFixture(owner.db, "members-role");
    const admin = await login(app, t.users.admin.email);
    const member = await login(app, t.users.member.email);
    const viewer = await login(app, t.users.viewer.email);
    const create = (cookie: string) =>
      call(app, "POST", "/api/projects", { cookie, body: { name: "ロールの確かめ" } });
    expect((await create(member)).status).toBe(201);

    const res = await changeRole(admin, t.users.member.id, "viewer");
    expect(res.status).toBe(200);
    expect(((await res.json()) as OrganizationMember).role).toBe("viewer");
    expect((await create(member)).status).toBe(403);

    expect((await call(app, "GET", "/api/audit-events", { cookie: viewer })).status).toBe(403);
    expect((await changeRole(admin, t.users.viewer.id, "admin")).status).toBe(200);
    expect((await call(app, "GET", "/api/audit-events", { cookie: viewer })).status).toBe(200);

    expect(await auditActions(admin)).toEqual(
      expect.arrayContaining([{ action: "member.role_change", outcome: "allowed" }]),
    );
  });

  it("2人の管理者が同時にお互いを外しても、有効な管理者は0人にならない(後の方は 403)", async () => {
    const t = await createTenantFixture(owner.db, "members-race");
    // 2人目の管理者(ログインできるように、元の閲覧者を管理者にする)
    const admin = await login(app, t.users.admin.email);
    expect((await changeRole(admin, t.users.viewer.id, "admin")).status).toBe(200);
    const second = await login(app, t.users.viewer.email);

    const [a, b] = await Promise.all([
      changeRole(admin, t.users.viewer.id, "member"),
      changeRole(second, t.users.admin.id, "member"),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 403]);
    const admins = await withTenant(owner.db, t.tenantId, (tx) =>
      tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.tenantId, t.tenantId), eq(users.role, "admin"))),
    );
    expect(admins).toHaveLength(1);
  });

  it("止めた管理者は、有効な管理者に数えない(止めた側が最後の1人でも、ほかの人は変えられる)", async () => {
    const t = await createTenantFixture(owner.db, "members-disabled-admin");
    const extra = await addAdmin(t, "extra");
    const admin = await login(app, t.users.admin.email);
    expect((await disable(admin, extra)).status).toBe(200);
    expect((await changeRole(admin, extra, "member")).status).toBe(200);
    expect((await enable(admin, extra)).status).toBe(200);
  });
});

describe("SSO の緊急用と、情シスの道具の人", () => {
  it("SSO を必須にしている間は、最後の緊急用の管理者を止める・外すと 409。ほかに緊急用がいれば外れて、緊急用からも外れる", async () => {
    const t = await createTenantFixture(owner.db, "members-sso");
    const extra = await addAdmin(t, "exempt");
    await withTenant(owner.db, t.tenantId, async (tx) => {
      await tx.insert(ssoConnections).values({
        id: uuidv7(),
        tenantId: t.tenantId,
        providerName: `idp-${t.tenantId.slice(-12)}`,
        required: true,
      });
      await tx
        .update(users)
        .set({ ssoExempt: true })
        .where(and(eq(users.tenantId, t.tenantId), eq(users.id, extra)));
    });
    const admin = await login(app, t.users.admin.email);
    expect(await codeOf(await disable(admin, extra))).toBe("last_sso_exempt");
    expect(await codeOf(await changeRole(admin, extra, "member"))).toBe("last_sso_exempt");

    // 自分(操作する管理者)も緊急用にすれば、もう1人を外せる
    await withTenant(owner.db, t.tenantId, (tx) =>
      tx
        .update(users)
        .set({ ssoExempt: true })
        .where(and(eq(users.tenantId, t.tenantId), eq(users.id, t.users.admin.id))),
    );
    expect((await changeRole(admin, extra, "member")).status).toBe(200);
    const [row] = await withTenant(owner.db, t.tenantId, (tx) =>
      tx
        .select({ ssoExempt: users.ssoExempt })
        .from(users)
        .where(and(eq(users.tenantId, t.tenantId), eq(users.id, extra))),
    );
    expect(row?.ssoExempt).toBe(false);
  });

  it("情シスの道具が扱える人(確かめたドメイン・生きている SCIM の鍵)には印が付き、画面からも止められる", async () => {
    const t = await createTenantFixture(owner.db, "members-scim");
    await withTenant(owner.db, t.tenantId, async (tx) => {
      await tx.insert(domains).values({
        id: uuidv7(),
        tenantId: t.tenantId,
        domain: "members-scim.test",
        verifyToken: uuidv7(),
        verifiedAt: new Date(),
        createdBy: t.users.admin.id,
      });
      await tx.insert(scimTokens).values({
        id: uuidv7(),
        tenantId: t.tenantId,
        tokenHash: `fixture-${uuidv7()}`,
        createdBy: t.users.admin.id,
      });
    });
    const admin = await login(app, t.users.admin.email);
    const list = await call(app, "GET", "/api/organization/members?limit=100", { cookie: admin });
    const members = ((await list.json()) as { members: OrganizationMember[] }).members;
    expect(members.every((m) => m.scimManaged)).toBe(true);
    expect((await disable(admin, t.users.member.id)).status).toBe(200);
  });
});

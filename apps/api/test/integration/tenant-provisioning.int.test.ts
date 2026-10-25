import type { Me, ProjectPage } from "@app/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../../src/db/client.ts";
import { withTenant } from "../../src/db/tenant.ts";
import {
  createTenant,
  parseTenantApplication,
  type TenantApplication,
} from "../../src/onboarding/create-tenant.ts";
import {
  call,
  createTenantFixture,
  createTestApp,
  login,
  type TenantFixture,
} from "../helpers/fixtures.ts";

// 組織の開通(docs/specs/0026-tenant-provisioning.md)の受け入れ条件。すでにある2社(+運営)の隣に作る。

const owner = createDb(inject("ownerUrl"));
let a: TenantFixture;
let ops: TenantFixture;
let app: ReturnType<typeof createTestApp>["app"];
let pool: ReturnType<typeof createTestApp>["pool"];

beforeAll(async () => {
  a = await createTenantFixture(owner.db, "acme");
  ops = await createTenantFixture(owner.db, "ops");
  ({ app, pool } = createTestApp(inject("appUrl"), { SUPPORT_TENANT_ID: ops.tenantId }));
});
afterAll(async () => {
  await owner.pool.end();
  await pool.end();
});

let n = 0;
/** 申し込み(メールは毎回ちがう。大文字まじりで渡し、小文字で入ることも見る) */
function application(over: Partial<TenantApplication> = {}): TenantApplication {
  n += 1;
  const { application } = parseTenantApplication(
    JSON.stringify({
      name: `工務店 ${n}-${Date.now()}`,
      timeZone: "Asia/Tokyo",
      mfaRequired: true,
      admin: { email: `Owner-${n}-${Date.now()}@Koumuten.test`, name: "工藤 一郎" },
    }),
  );
  return { ...application, ...over };
}

const opts = (execute: boolean, confirmName?: string) => ({
  execute,
  ...(confirmName === undefined ? {} : { confirmName }),
  supportTenantId: ops.tenantId,
});

async function tenantRow(tenantId: string) {
  const r = await withTenant(owner.db, tenantId, (tx) =>
    tx.execute<{ name: string; time_zone: string; mfa_required: boolean }>(
      sql`select name, time_zone, mfa_required from organizations.tenants where tenant_id = ${tenantId}`,
    ),
  );
  return r.rows[0];
}

async function auditRows(tenantId: string, targetId: string) {
  const r = await withTenant(owner.db, tenantId, (tx) =>
    tx.execute<{ action: string; actor_kind: string; details: Record<string, unknown> }>(
      sql`select action, actor_kind, details from platform.audit_events
        where tenant_id = ${tenantId} and target_id = ${targetId}`,
    ),
  );
  return r.rows;
}

describe("試し(--execute なし)", () => {
  it("流してから取り消すので、組織も人も監査ログも残らない", async () => {
    const app1 = application();
    const plan = await createTenant(owner.db, app1, opts(false));
    expect(plan.timeZone).toBe("Asia/Tokyo");
    expect(plan.mfaRequired).toBe(true);
    expect(await tenantRow(plan.tenantId)).toBeUndefined();
    expect(await auditRows(ops.tenantId, plan.tenantId)).toEqual([]);
    // 同じ申し込みで、そのまま本番を流せる(メールアドレスも残っていない)
    const done = await createTenant(owner.db, app1, opts(true, app1.name));
    expect(await tenantRow(done.tenantId)).toBeDefined();
  });

  it("本番で落ちる理由(ほかの組織で使われているメール)は、試しでも落ちる", async () => {
    const taken = application({ admin: { email: a.users.member.email, name: "誰か" } });
    await expect(createTenant(owner.db, taken, opts(false))).rejects.toThrow(
      /もうどこかの組織で使われています/,
    );
  });
});

describe("本番(--execute --confirm-name)", () => {
  it("名前が違えば何も作らない", async () => {
    const app1 = application();
    await expect(createTenant(owner.db, app1, opts(true, "違う名前"))).rejects.toThrow(
      /--confirm-name/,
    );
    // 同じメールで作り直せる = 何も残っていない
    await expect(createTenant(owner.db, app1, opts(true, app1.name))).resolves.toBeDefined();
  });

  it("組織(時間帯・二段階認証の必須)と、最初の管理者(小文字のメール・Cognito とはまだ結びつかない)を作る", async () => {
    const app1 = application();
    const done = await createTenant(owner.db, app1, opts(true, app1.name));
    expect(await tenantRow(done.tenantId)).toEqual({
      name: app1.name,
      time_zone: "Asia/Tokyo",
      mfa_required: true,
    });
    const r = await withTenant(owner.db, done.tenantId, (tx) =>
      tx.execute<{ id: string; email: string; role: string; external_id: string | null }>(
        sql`select id, email, role, external_id from organizations.users where tenant_id = ${done.tenantId}`,
      ),
    );
    expect(r.rows).toEqual([
      { id: done.adminUserId, email: app1.admin.email, role: "admin", external_id: null },
    ]);
    expect(app1.admin.email).toBe(app1.admin.email.toLowerCase());
  });

  it("作った組織と運営の組織の両方の監査ログに、仕組みとして残る(名前・メールは入らない)", async () => {
    const app1 = application();
    const done = await createTenant(owner.db, app1, opts(true, app1.name));
    for (const tenantId of [done.tenantId, ops.tenantId]) {
      const rows = await auditRows(tenantId, done.tenantId);
      expect(rows).toEqual([
        {
          action: "tenant.create",
          actor_kind: "system",
          details: { adminUserId: done.adminUserId },
        },
      ]);
    }
  });

  it("最初の管理者はその組織に入れ、ほかの組織の物は見えない", async () => {
    const app1 = application();
    const done = await createTenant(owner.db, app1, opts(true, app1.name));
    const cookie = await login(app, app1.admin.email);
    const me = (await (await call(app, "GET", "/api/me", { cookie })).json()) as Me;
    expect(me).toMatchObject({ tenantId: done.tenantId, tenantName: app1.name, role: "admin" });
    // 初めての人なので、規約の同意から(docs/specs/0009-legal-consent.md)
    const consents = me.legal?.pending ?? [];
    expect(consents.length).toBeGreaterThan(0);
    const agreed = await call(app, "POST", "/api/legal/consents", { cookie, body: { consents } });
    expect(agreed.status).toBe(204);
    const projects = (await (
      await call(app, "GET", "/api/projects", { cookie })
    ).json()) as ProjectPage;
    expect(projects.projects).toEqual([]);
    const other = await call(app, "GET", `/api/projects/${a.projectId}`, { cookie });
    expect(other.status).toBe(404);
  });

  it("同じ申し込みを2回流しても、2つ目は作らない(最初の管理者のメールが重なる)", async () => {
    const app1 = application();
    await createTenant(owner.db, app1, opts(true, app1.name));
    await expect(createTenant(owner.db, app1, opts(true, app1.name))).rejects.toThrow(
      /もうどこかの組織で使われています/,
    );
  });

  it("運営の組織が無い環境(SUPPORT_TENANT_ID なし)でも作れる(作った組織にだけ残る)", async () => {
    const app1 = application();
    const done = await createTenant(owner.db, app1, {
      execute: true,
      confirmName: app1.name,
      supportTenantId: null,
    });
    expect(await auditRows(done.tenantId, done.tenantId)).toHaveLength(1);
    expect(await auditRows(ops.tenantId, done.tenantId)).toEqual([]);
  });
});

import type { AuditEventPage, ExportData } from "@app/shared";
import { EXPORT_FORMAT } from "@app/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../../src/db/client.ts";
import { users } from "../../src/db/schema.ts";
import { withTenant } from "../../src/db/tenant.ts";
import {
  deleteTenant,
  planTenantDeletion,
  TENANT_TABLES,
} from "../../src/offboarding/delete-tenant.ts";
import {
  call,
  createTenantFixture,
  createTestApp,
  login,
  type TenantFixture,
} from "../helpers/fixtures.ts";

// 解約(docs/specs/0005-offboarding.md)の受け入れ条件。必ず2社(+運営)で。

const owner = createDb(inject("ownerUrl"));
let a: TenantFixture;
let b: TenantFixture;
let ops: TenantFixture;
let app: ReturnType<typeof createTestApp>["app"];
let pool: ReturnType<typeof createTestApp>["pool"];

async function countRows(tenantId: string, table: string): Promise<number> {
  const [schema, rel] = table.split(".");
  return withTenant(owner.db, tenantId, async (tx) => {
    const r = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(schema as string)}.${sql.identifier(rel as string)} where tenant_id = ${tenantId}`,
    );
    return r.rows[0]?.n ?? 0;
  });
}

beforeAll(async () => {
  a = await createTenantFixture(owner.db, "acme");
  b = await createTenantFixture(owner.db, "globex");
  ops = await createTenantFixture(owner.db, "ops");
  ({ app, pool } = createTestApp(inject("appUrl"), { SUPPORT_TENANT_ID: ops.tenantId }));
  // a に、全部の種類の行を作る(監査ログ・送信待ち・サポートの入室も)
  await withTenant(owner.db, a.tenantId, (tx) =>
    tx
      .update(users)
      .set({ externalId: `cognito-sub-${a.tenantId}` })
      .where(eq(users.id, a.users.admin.id)),
  );
  const aAdmin = await login(app, a.users.admin.email);
  const aMember = await login(app, a.users.member.email);
  await call(app, "PATCH", `/api/tasks/${a.taskId}`, { cookie: aMember, body: { done: true } });
  const grant = (await (
    await call(app, "POST", "/api/support-grants", { cookie: aAdmin, body: { hours: 1 } })
  ).json()) as { code: string };
  const staff = await login(app, ops.users.member.email);
  await call(app, "POST", "/api/support/sessions", { cookie: staff, body: { code: grant.code } });
});
afterAll(async () => {
  await owner.pool.end();
  await pool.end();
});

describe("書き出し(管理者)", () => {
  it("自社のデータが1つの JSON で出て、他社の物・秘密は入らない。書き出したことが残る", async () => {
    const aAdmin = await login(app, a.users.admin.email);
    const res = await call(app, "POST", "/api/exports", { cookie: aAdmin });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="export-/);
    const text = await res.text();
    const data = JSON.parse(text) as ExportData;
    expect(data.format).toBe(EXPORT_FORMAT);
    expect(data.organization.id).toBe(a.tenantId);
    expect(data.users.map((u) => u.id)).toContain(a.users.member.id);
    expect(data.projects.map((p) => p.id)).toContain(a.projectId);
    expect(data.tasks).toContainEqual(expect.objectContaining({ id: a.taskId, done: true }));
    expect(data.auditEvents.map((e) => e.action)).toContain("task.update");
    expect(data.supportGrants.length).toBeGreaterThan(0);
    // 他社の物・認証の製品の ID・番号のハッシュは入らない
    expect(text).not.toContain(b.projectId);
    expect(text).not.toContain(b.users.admin.email);
    expect(text).not.toContain("cognito-sub-");
    expect(text).not.toMatch(/code_?hash/i);

    const audit = await call(app, "GET", "/api/audit-events", { cookie: aAdmin });
    const [latest] = ((await audit.json()) as AuditEventPage).events;
    expect(latest).toMatchObject({ action: "data.export", actor: { id: a.users.admin.id } });
  });

  it("メンバーは書き出せない(403)", async () => {
    const aMember = await login(app, a.users.member.email);
    expect((await call(app, "POST", "/api/exports", { cookie: aMember })).status).toBe(403);
  });
});

describe("削除(運営のコマンド)", () => {
  it("tenant_id を持つ表は、全部消す一覧にある(表を足したら一覧にも足す)", async () => {
    const r = await withTenant(owner.db, a.tenantId, (tx) =>
      tx.execute<{ t: string }>(
        sql`select table_schema || '.' || table_name as t from information_schema.columns
             where column_name = 'tenant_id' and table_schema in ('organizations', 'projects', 'tasks', 'platform')`,
      ),
    );
    const missing = r.rows
      .map((row) => row.t)
      .filter((t) => !(TENANT_TABLES as readonly string[]).includes(t));
    expect(missing, "src/offboarding/delete-tenant.ts の TENANT_TABLES に足してください").toEqual(
      [],
    );
  });

  it("試しは数えるだけで、何も消さない。Cognito の利用者も出る", async () => {
    const plan = await planTenantDeletion(owner.db, a.tenantId);
    expect(plan?.counts["tasks.tasks"]).toBeGreaterThan(0);
    expect(plan?.counts["platform.audit_events"]).toBeGreaterThan(0);
    expect(plan?.counts["platform.outbox"]).toBeGreaterThan(0);
    expect(plan?.counts["organizations.support_sessions"]).toBeGreaterThan(0);
    expect(plan?.cognitoSubs).toEqual([`cognito-sub-${a.tenantId}`]);
    expect(await countRows(a.tenantId, "projects.projects")).toBeGreaterThan(0);
  });

  it("名前が違えば何も消さない", async () => {
    await expect(
      deleteTenant(owner.db, a.tenantId, {
        confirmName: "違う名前",
        supportTenantId: ops.tenantId,
      }),
    ).rejects.toThrow(/confirm-name/);
    expect(await countRows(a.tenantId, "organizations.tenants")).toBe(1);
  });

  it("運営の組織は消せない", async () => {
    const plan = await planTenantDeletion(owner.db, ops.tenantId);
    await expect(
      deleteTenant(owner.db, ops.tenantId, {
        confirmName: plan?.tenantName ?? "",
        supportTenantId: ops.tenantId,
      }),
    ).rejects.toThrow(/運営/);
  });

  it("消すと、その組織の全部の表が空になり、他社は変わらず、運営の記録に残る", async () => {
    const before = await planTenantDeletion(owner.db, b.tenantId);
    const plan = await planTenantDeletion(owner.db, a.tenantId);
    await deleteTenant(owner.db, a.tenantId, {
      confirmName: plan?.tenantName ?? "",
      supportTenantId: ops.tenantId,
    });
    for (const t of TENANT_TABLES) expect(await countRows(a.tenantId, t), t).toBe(0);
    expect((await planTenantDeletion(owner.db, b.tenantId))?.counts).toEqual(before?.counts);

    const opsAdmin = await login(app, ops.users.admin.email);
    const res = await call(app, "GET", "/api/audit-events", { cookie: opsAdmin });
    const events = ((await res.json()) as AuditEventPage).events;
    expect(events).toContainEqual(
      expect.objectContaining({
        action: "tenant.delete",
        actor: expect.objectContaining({ kind: "system" }),
        target: { type: "organization", id: a.tenantId },
      }),
    );
    // 名前は残さない
    expect(JSON.stringify(events)).not.toContain(plan?.tenantName ?? "x");
    // 消した組織の人はもうログインできない
    await expect(login(app, a.users.admin.email)).rejects.toThrow();
  });
});

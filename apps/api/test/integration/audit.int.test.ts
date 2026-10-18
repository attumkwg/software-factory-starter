import type { AuditEventPage } from "@app/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../../src/db/client.ts";
import { withTenant } from "../../src/db/tenant.ts";
import {
  call,
  createTenantFixture,
  createTestApp,
  login,
  type TenantFixture,
} from "../helpers/fixtures.ts";

// 監査ログ(docs/specs/0003-audit-log.md)の受け入れ条件。必ず2社で。

const owner = createDb(inject("ownerUrl"));
const appDb = createDb(inject("appUrl"));
const { app, pool } = createTestApp(inject("appUrl"));
let a: TenantFixture;
let b: TenantFixture;
let aAdmin: string;
let aMember: string;
let aViewer: string;
let bAdmin: string;

async function events(cookie: string, query = "") {
  const res = await call(app, "GET", `/api/audit-events${query}`, { cookie });
  expect(res.status).toBe(200);
  return (await res.json()) as AuditEventPage;
}

beforeAll(async () => {
  a = await createTenantFixture(owner.db, "acme");
  b = await createTenantFixture(owner.db, "globex");
  aAdmin = await login(app, a.users.admin.email);
  aMember = await login(app, a.users.member.email);
  aViewer = await login(app, a.users.viewer.email);
  bAdmin = await login(app, b.users.admin.email);
});
afterAll(async () => {
  await owner.pool.end();
  await appDb.pool.end();
  await pool.end();
});

describe("書き込みが残る", () => {
  it("作る・直す・消すが、誰が・何を・どれに、で残る(値は残らない)", async () => {
    const created = await call(app, "POST", `/api/projects/${a.projectId}/tasks`, {
      cookie: aMember,
      body: { title: "監査の題名(残らない)" },
    });
    expect(created.status).toBe(201);
    const task = (await created.json()) as { id: string };
    await call(app, "PATCH", `/api/tasks/${task.id}`, {
      cookie: aMember,
      // 決めていない項目(メールアドレスの形)は、記録に入らない
      body: { done: true, title: "直した題名(残らない)", "taro@example.com": 1 },
    });
    await call(app, "DELETE", `/api/tasks/${task.id}`, { cookie: aMember });

    const { events: list } = await events(aAdmin);
    const mine = list.filter((e) => e.target?.id === task.id);
    expect(mine.map((e) => e.action)).toEqual(["task.delete", "task.update", "task.create"]);
    expect(mine[2]).toMatchObject({
      actor: { kind: "user", id: a.users.member.id, name: expect.any(String) },
      target: { type: "task", id: task.id },
      outcome: "allowed",
      details: { projectId: a.projectId },
    });
    expect(mine[1]?.details).toEqual({ fields: ["done", "title"] });
    expect(JSON.stringify(list)).not.toContain("題名");
    expect(JSON.stringify(list)).not.toContain("taro@example.com");
  });

  it("失敗した書き込みは残らない(起きていないことは記録しない)", async () => {
    const before = (await events(aAdmin)).events.length;
    const res = await call(app, "POST", "/api/projects", { cookie: aMember, body: { name: "" } });
    expect(res.status).toBe(400);
    const missing = await call(app, "DELETE", `/api/tasks/${b.taskId}`, { cookie: aMember });
    expect(missing.status).toBe(404);
    expect((await events(aAdmin)).events.length).toBe(before);
  });

  it("権限が無くて断られた書き込みは「拒否」で残り、書き込みは起きていない", async () => {
    const res = await call(app, "DELETE", `/api/projects/${a.projectId}`, { cookie: aViewer });
    expect(res.status).toBe(403);
    const [latest] = (await events(aAdmin)).events;
    expect(latest).toMatchObject({
      action: "project.delete",
      outcome: "denied",
      actor: { id: a.users.viewer.id },
      target: { type: "project", id: a.projectId },
    });
  });

  it("ログインとログアウトが残る", async () => {
    const cookie = await login(app, a.users.member.email);
    await call(app, "POST", "/api/auth/logout", { cookie });
    const actions = (await events(aAdmin)).events.slice(0, 2).map((e) => e.action);
    expect(actions).toEqual(["auth.logout", "auth.login"]);
  });
});

describe("見られる人", () => {
  it("管理者だけ(メンバー・閲覧者は 403)", async () => {
    expect((await call(app, "GET", "/api/audit-events", { cookie: aMember })).status).toBe(403);
    expect((await call(app, "GET", "/api/audit-events", { cookie: aViewer })).status).toBe(403);
  });

  it("他社の記録は見えない", async () => {
    const { events: list } = await events(bAdmin);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((e) => e.target?.id !== a.projectId)).toBe(true);
    expect(JSON.stringify(list)).not.toContain(a.users.member.id);
  });

  it("50件ずつ、続きを読める(重ならず、抜けない)", async () => {
    for (let i = 0; i < 6; i++) {
      await call(app, "POST", "/api/projects", { cookie: aAdmin, body: { name: `p${i}` } });
    }
    const all = (await events(aAdmin, "?limit=100")).events.map((e) => e.id);
    const first = await events(aAdmin, "?limit=4");
    expect(first.nextCursor).not.toBeNull();
    const second = await events(aAdmin, `?limit=4&before=${first.nextCursor}`);
    expect([...first.events, ...second.events].map((e) => e.id)).toEqual(all.slice(0, 8));
    expect((await call(app, "GET", "/api/audit-events?before=xx", { cookie: aAdmin })).status).toBe(
      400,
    );
  });
});

describe("足すだけ(直せない・消せない)", () => {
  it("アプリの接続ユーザーは直す・消すができない", async () => {
    await expect(
      withTenant(appDb.db, a.tenantId, (tx) =>
        tx.execute(sql`update platform.audit_events set action = 'x'`),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(appDb.db, a.tenantId, (tx) => tx.execute(sql`delete from platform.audit_events`)),
    ).rejects.toThrow();
  });

  it("表の持ち主でも、決まった手順の外では直す・消すができない", async () => {
    await expect(
      withTenant(owner.db, a.tenantId, (tx) =>
        tx.execute(sql`update platform.audit_events set action = 'x'`),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(owner.db, a.tenantId, (tx) => tx.execute(sql`delete from platform.audit_events`)),
    ).rejects.toThrow();
  });

  it("決まった手順(app.audit_purge = 'on')の中なら、表の持ち主は消せる", async () => {
    const tmp = await createTenantFixture(owner.db, "purge");
    const cookie = await login(app, tmp.users.admin.email);
    await call(app, "POST", "/api/auth/logout", { cookie });
    const count = async () =>
      withTenant(owner.db, tmp.tenantId, async (tx) => {
        const r = await tx.execute(sql`select count(*)::int as n from platform.audit_events`);
        return (r.rows[0] as { n: number }).n;
      });
    expect(await count()).toBe(2);
    await withTenant(owner.db, tmp.tenantId, async (tx) => {
      await tx.execute(sql`select set_config('app.audit_purge', 'on', true)`);
      await tx.execute(sql`delete from platform.audit_events where tenant_id = ${tmp.tenantId}`);
    });
    expect(await count()).toBe(0);
  });
});

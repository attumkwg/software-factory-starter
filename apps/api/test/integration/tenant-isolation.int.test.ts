import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../../src/db/client.ts";
import {
  call,
  createTenantFixture,
  createTestApp,
  login,
  type TenantFixture,
} from "../helpers/fixtures.ts";

// API を通して「2社が混ざらない」ことを確かめる(docs/security.md の V-1: テストは必ず2社で)。

const owner = createDb(inject("ownerUrl"));
const { app, pool } = createTestApp(inject("appUrl"));
let a: TenantFixture;
let b: TenantFixture;
let aAdmin: string;
let bAdmin: string;

beforeAll(async () => {
  a = await createTenantFixture(owner.db, "acme");
  b = await createTenantFixture(owner.db, "globex");
  aAdmin = await login(app, a.users.admin.email);
  bAdmin = await login(app, b.users.admin.email);
});
afterAll(async () => {
  await owner.pool.end();
  await pool.end();
});

describe("2社の分離", () => {
  it("一覧に他社のプロジェクトが混ざらない", async () => {
    const res = await call(app, "GET", "/api/projects", { cookie: bAdmin });
    const { projects } = (await res.json()) as { projects: { id: string }[] };
    expect(projects.map((p) => p.id)).toContain(b.projectId);
    expect(projects.map((p) => p.id)).not.toContain(a.projectId);
  });

  it("他社のプロジェクトにタスクを足せない(404)", async () => {
    const res = await call(app, "POST", `/api/projects/${a.projectId}/tasks`, {
      cookie: bAdmin,
      body: { title: "入り込む" },
    });
    expect(res.status).toBe(404);
  });

  it("他社のタスクを書き換えられず、元のまま残る", async () => {
    const res = await call(app, "PATCH", `/api/tasks/${a.taskId}`, {
      cookie: bAdmin,
      body: { title: "乗っ取り" },
    });
    expect(res.status).toBe(404);
    const list = await call(app, "GET", `/api/projects/${a.projectId}/tasks`, { cookie: aAdmin });
    const { tasks } = (await list.json()) as { tasks: { id: string; title: string }[] };
    expect(tasks.find((t) => t.id === a.taskId)?.title).toBe("最初のタスク");
  });

  it("リクエストでテナントを名乗っても無視する(テナントはセッションから決める)", async () => {
    const res = await call(app, "GET", `/api/projects/${a.projectId}`, {
      cookie: bAdmin,
      headers: { "x-tenant-id": a.tenantId },
    });
    expect(res.status).toBe(404);
    const me = (await (await call(app, "GET", "/api/me", { cookie: bAdmin })).json()) as {
      tenantId: string;
    };
    expect(me.tenantId).toBe(b.tenantId);
  });

  it("Cookie を書き換えて他社を名乗ると、署名が合わず 401", async () => {
    const [name, value] = bAdmin.split("=");
    const [userId, , exp, ...sig] = decodeURIComponent(value ?? "").split(".");
    const forged = `${name}=${encodeURIComponent([userId, a.tenantId, exp, ...sig].join("."))}`;
    const res = await call(app, "GET", "/api/projects", { cookie: forged });
    expect(res.status).toBe(401);
  });
});

import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../../src/db/client.ts";
import {
  call,
  createTenantFixture,
  createTestApp,
  login,
  type TenantFixture,
} from "../helpers/fixtures.ts";

// Schemathesis(pnpm security:fuzz)が見つけた穴の再現テスト。
// 本文の無い POST / PATCH が検証を素通りして 500 になっていた → 本文を必須(jsonBody)にして 400 に。

const owner = createDb(inject("ownerUrl"));
const { app, pool } = createTestApp(inject("appUrl"));
let a: TenantFixture;
let admin: string;

beforeAll(async () => {
  a = await createTenantFixture(owner.db, "input");
  admin = await login(app, a.users.admin.email);
});
afterAll(async () => {
  await owner.pool.end();
  await pool.end();
});

describe("本文が無い・形式が違うときは 400 / 415(500 にしない)", () => {
  it("ログイン: 本文が無い", async () => {
    expect((await call(app, "POST", "/api/auth/dev-login")).status).toBe(400);
  });

  it("プロジェクトを作る: 本文が無ければ 400 で、何も作られない", async () => {
    const before = (await (await call(app, "GET", "/api/projects", { cookie: admin })).json()) as {
      projects: unknown[];
    };
    expect((await call(app, "POST", "/api/projects", { cookie: admin })).status).toBe(400);
    const after = (await (await call(app, "GET", "/api/projects", { cookie: admin })).json()) as {
      projects: unknown[];
    };
    expect(after.projects.length).toBe(before.projects.length);
  });

  it("タスクを足す: JSON ではない本文は 415(Unsupported Media Type)", async () => {
    const res = await app.request(`/api/projects/${a.projectId}/tasks`, {
      method: "POST",
      headers: { cookie: admin, origin: "http://localhost", "content-type": "text/plain" },
      body: "title=hello",
    });
    expect(res.status).toBe(415);
  });

  it("タスクを直す: 本文が無い", async () => {
    expect((await call(app, "PATCH", `/api/tasks/${a.taskId}`, { cookie: admin })).status).toBe(
      400,
    );
  });
});

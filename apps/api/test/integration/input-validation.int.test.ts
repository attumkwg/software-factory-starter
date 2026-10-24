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
let member: string;
let viewer: string;

beforeAll(async () => {
  a = await createTenantFixture(owner.db, "input");
  admin = await login(app, a.users.admin.email);
  member = await login(app, a.users.member.email);
  viewer = await login(app, a.users.viewer.email);
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

// 2026-10-24 のファズ(ログインした役割)で見つかった 500 の再現。
// 権限の無い書き込みは、パスの ID を確かめる前に関所が 403 で断り、「拒否」を監査ログに残す。
// そのとき ID の形でない値(null,null・NUL・壊れた %)をそのまま uuid の列や details に入れて、DB が拒んでいた。
describe("権限の無い書き込みに形の違う ID を渡しても 403(500 にしない)", () => {
  const latestEvent = async () => {
    const res = await call(app, "GET", "/api/audit-events?limit=1", { cookie: admin });
    return ((await res.json()) as { events: Record<string, unknown>[] }).events[0];
  };

  it.each([
    [
      "閲覧者がプロジェクトを消す",
      "viewer",
      "DELETE",
      "/api/projects/null%2Cnull",
      "project.delete",
    ],
    [
      "メンバーがプロジェクトを消す",
      "member",
      "DELETE",
      "/api/projects/null%2Cnull",
      "project.delete",
    ],
    ["閲覧者がタスクを消す", "viewer", "DELETE", "/api/tasks/null%2Cnull", "task.delete"],
    ["閲覧者がタスクを直す", "viewer", "PATCH", "/api/tasks/null%2Cnull", "task.update"],
    [
      "メンバーが代理の許可を取り消す",
      "member",
      "DELETE",
      "/api/support-grants/null%2Cnull",
      "support_grant.revoke",
    ],
    ["NUL の ID", "viewer", "DELETE", "/api/projects/%00", "project.delete"],
    ["壊れた % の ID", "viewer", "DELETE", "/api/projects/%E0%A4%A", "project.delete"],
  ])("%s: 403 で、拒否は対象なしで残る", async (_name, role, method, path, action) => {
    const cookie = role === "viewer" ? viewer : member;
    const body = method === "PATCH" ? { title: "0", done: false } : undefined;
    const res = await call(app, method, path, { cookie, body });
    expect(res.status).toBe(403);
    expect(await latestEvent()).toMatchObject({ action, outcome: "denied", target: null });
  });

  it("ほかのパスの ID が形の違う値なら details に入れない(タスクを足すプロジェクトが NUL)", async () => {
    const res = await call(app, "POST", "/api/projects/%00/tasks", {
      cookie: viewer,
      body: { title: "x" },
    });
    expect(res.status).toBe(403);
    expect(await latestEvent()).toMatchObject({ action: "task.create", details: {} });
  });
});

describe("名前・題名に NUL(文字の0番)があれば 400(DB は NUL を持てない)", () => {
  it("タスクを足す", async () => {
    const res = await call(app, "POST", `/api/projects/${a.projectId}/tasks`, {
      cookie: admin,
      body: { title: "\u0000\udac5\uddcf\u00b6" },
    });
    expect(res.status).toBe(400);
  });

  it("タスクを直す", async () => {
    const res = await call(app, "PATCH", `/api/tasks/${a.taskId}`, {
      cookie: admin,
      body: { title: "a\u0000b" },
    });
    expect(res.status).toBe(400);
  });

  it("プロジェクトを作る", async () => {
    const res = await call(app, "POST", "/api/projects", {
      cookie: admin,
      body: { name: "a\u0000b" },
    });
    expect(res.status).toBe(400);
  });

  it("対になっていないサロゲートなど、NUL でない変わった文字は保存でき、一覧も 200", async () => {
    const res = await call(app, "POST", `/api/projects/${a.projectId}/tasks`, {
      cookie: admin,
      body: { title: "\udac5\u00b6\u0092😀" },
    });
    expect(res.status).toBe(201);
    const list = await call(app, "GET", `/api/projects/${a.projectId}/tasks?limit=13`, {
      cookie: admin,
    });
    expect(list.status).toBe(200);
    expect((await call(app, "GET", "/api/projects?limit=13", { cookie: admin })).status).toBe(200);
  });
});

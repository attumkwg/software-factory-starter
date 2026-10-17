import type { Role } from "@app/shared";
import { v7 as uuidv7 } from "uuid";
import { createApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config.ts";
import { createDb, type RootDb } from "../../src/db/client.ts";
import { projects, tasks, tenants, users } from "../../src/db/schema.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { createLogger } from "../../src/logger.ts";

/** 1社ぶんのテスト用データ。テストは必ず2社以上で書く(自社と他社)。 */
export type TenantFixture = {
  tenantId: string;
  users: Record<Role, { id: string; email: string }>;
  projectId: string;
  taskId: string;
};

export async function createTenantFixture(ownerDb: RootDb, label = "t"): Promise<TenantFixture> {
  const tenantId = uuidv7();
  const suffix = tenantId.slice(-12);
  const mk = (role: Role) => ({ id: uuidv7(), email: `${role}-${suffix}@${label}.test`, role });
  const admin = mk("admin");
  const member = mk("member");
  const viewer = mk("viewer");
  const projectId = uuidv7();
  const taskId = uuidv7();

  await withTenant(ownerDb, tenantId, async (tx) => {
    await tx.insert(tenants).values({ tenantId, name: `${label}-${suffix}` });
    await tx
      .insert(users)
      .values(
        [admin, member, viewer].map((u) => ({ ...u, tenantId, name: `${u.role} ${suffix}` })),
      );
    await tx
      .insert(projects)
      .values({ id: projectId, tenantId, name: "最初の計画", createdBy: admin.id });
    await tx.insert(tasks).values({ id: taskId, tenantId, projectId, title: "最初のタスク" });
  });

  return {
    tenantId,
    users: {
      admin: { id: admin.id, email: admin.email },
      member: { id: member.id, email: member.email },
      viewer: { id: viewer.id, email: viewer.email },
    },
    projectId,
    taskId,
  };
}

/** アプリの接続ユーザー(RLS がかかる)で組み立てた、本物と同じアプリ。 */
export function createTestApp(appUrl: string) {
  const { db, pool } = createDb(appUrl);
  const config = loadConfig({
    APP_ENV: "test",
    DATABASE_URL: appUrl,
    SESSION_SECRET: "integration-test-secret-0123456789abcdef",
  });
  const lifecycle = { shuttingDown: false };
  const app = createApp({ config, db, logger: createLogger({ level: "silent" }), lifecycle });
  return { app, pool, lifecycle };
}

type TestApp = ReturnType<typeof createTestApp>["app"];

/** 開発用ログインで Cookie をもらう。 */
export async function login(app: TestApp, email: string): Promise<string> {
  const res = await app.request("/api/auth/dev-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("no cookie");
  return setCookie.split(";")[0] ?? "";
}

export function call(
  app: TestApp,
  method: string,
  path: string,
  opts: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  // ブラウザと同じく Origin を付ける(付けないと CSRF の守りで 403 になる)
  const headers: Record<string, string> = { origin: "http://localhost", ...opts.headers };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

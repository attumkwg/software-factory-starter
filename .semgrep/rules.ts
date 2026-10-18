// .semgrep/rules.yml のテスト(semgrep scan --test .semgrep)。ここは実行されないお手本。
// 「ruleid」の注釈 = 止まるべき行 /「ok」の注釈 = 止まってはいけない行

// ruleid: tenant-scoped-db-only
import { Pool } from "pg";
// ruleid: tenant-scoped-db-only
import { createDb } from "../db/client.ts";
// ok: tenant-scoped-db-only
import type { TenantTx } from "../db/client.ts";

declare const logger: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
declare const user: { id: string; email: string };
declare const err: Error;
declare const c: { req: { header: (n: string) => string; param: (n: string) => string } };
declare const sql: { raw: (s: string) => unknown };
declare const jsonBody: (schema: unknown) => unknown;

export function examples(input: string) {
  // ruleid: tenant-scoped-db-only
  const pool = new Pool();
  // ruleid: tenant-scoped-db-only
  createDb("postgres://");

  // ruleid: no-raw-sql
  sql.raw(`select * from projects where name = '${input}'`);

  // ruleid: no-whole-object-logging
  logger.info(user);
  // ruleid: no-whole-object-logging
  logger.info(user, "ログイン");
  // ok: no-whole-object-logging
  logger.info({ userId: user.id }, "ログイン");
  // ok: no-whole-object-logging
  logger.info("起動しました");
  // ok: no-whole-object-logging
  logger.error(err);

  // ruleid: tenant-from-request
  const tenantId = c.req.header("x-tenant-id");
  // ok: tenant-from-request
  const projectId = c.req.param("projectId");
  // ruleid: request-body-must-use-jsonbody
  const route = { request: { body: { content: { "application/json": { schema: {} } } } } };
  // ok: request-body-must-use-jsonbody
  const route2 = { request: { body: jsonBody({}) } };

  return [pool, tenantId, projectId, route, route2] as [Pool, string, string, unknown, unknown, TenantTx?];
}

declare const api: {
  createProject: (i: { name: string }) => Promise<unknown>;
  deleteTask: (id: string) => Promise<unknown>;
  listProjects: () => Promise<unknown>;
};
declare const creating: { run: (f: () => Promise<unknown>, o?: unknown) => Promise<boolean> };

export async function webWrites() {
  // ruleid: web-writes-through-use-action
  await api.createProject({ name: "失敗しても黙る" });
  // ruleid: web-writes-through-use-action
  void api.deleteTask("t1");
  // ok: web-writes-through-use-action
  await creating.run(() => api.createProject({ name: "受け止める" }), { success: "作りました" });
  // ok: web-writes-through-use-action
  await api.listProjects();
}

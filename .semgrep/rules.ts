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
declare const row: { id: string; title: string };
declare const body: { title: string };
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

  // ruleid: no-spread-in-logging
  logger.info({ ...row }, "作った");
  // ruleid: no-spread-in-logging
  logger.info({ taskId: row.id, ...row }, "作った");
  // ok: no-spread-in-logging
  logger.info({ taskId: row.id }, "作った");

  // ruleid: no-personal-field-logging
  logger.info({ title: body.title }, "作った");
  // ruleid: no-personal-field-logging
  logger.info({ label: body.title }, "作った");
  // ruleid: no-personal-field-logging
  logger.info({ staffEmail: input }, "入った");
  // ruleid: no-personal-field-logging
  logger.info({ userId: user.id, to: user.email }, "送った");
  // ok: no-personal-field-logging
  logger.info({ userId: user.id, durationMs: 3 }, "送った");
  // ok: no-personal-field-logging
  logger.info({ hasVerifiedEmail: true }, "ログインに失敗");

  // ruleid: no-template-in-log-message
  logger.info(`作った: ${body.title}`);
  // ruleid: no-template-in-log-message
  logger.error({ err }, `送れなかった: ${user.email}`);
  // ok: no-template-in-log-message
  logger.info({ taskId: row.id }, "作った");

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

declare const unitPrice: number;
declare const totalAmount: number;
declare const createdAt: Date;

export function moneyAndTime() {
  // ruleid: no-float-money
  const withTax = unitPrice * 1.1;
  // ruleid: no-float-money
  const shown = totalAmount.toFixed(2);
  // ok: no-float-money
  const doubled = totalAmount * 2;

  // ruleid: no-local-time
  const hour = createdAt.getHours();
  // ruleid: no-local-time
  const day = new Date(2026, 9, 18);
  // ruleid: no-local-time
  const label = createdAt.toLocaleDateString("ja-JP");
  // ok: no-local-time
  const utcDay = new Date(Date.UTC(2026, 9, 18)).getUTCDate();
  // ok: no-local-time
  const tokyo = createdAt.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });
  return [withTax, shown, doubled, hour, day, label, utcDay, tokyo];
}

// ruleid: file-storage-only-in-module
import { objectKey } from "../storage/keys.ts";
// ruleid: file-storage-only-in-module
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
// ruleid: file-storage-only-in-module
import { S3Client } from "@aws-sdk/client-s3";
// ok: file-storage-only-in-module
import type { ObjectStore } from "../storage/index.ts";

export const fileStorage = [objectKey, getSignedUrl, S3Client] as unknown as ObjectStore;

// ruleid: sensitive-data-only-in-module
import { tenantKeys } from "../sensitive/schema.ts";
// ruleid: sensitive-data-only-in-module
import { createSensitiveStore } from "./sensitive/store.ts";
// ruleid: sensitive-data-only-in-module
import { KMSClient } from "@aws-sdk/client-kms";
// ok: sensitive-data-only-in-module
import { sensitiveOf } from "../sensitive/index.ts";

declare const pgSchema: (name: string) => unknown;
declare const sqlId: { identifier: (n: string) => unknown };
declare const tx: { execute: (q: string) => Promise<unknown> };

export async function sensitiveData() {
  // ruleid: sensitive-data-only-in-module
  const health = pgSchema("sensitive");
  // ok: sensitive-data-only-in-module
  const tasksSchema = pgSchema("tasks");
  // ruleid: sensitive-data-only-in-module
  await tx.execute("select wrapped_key from sensitive.tenant_keys");
  // ruleid: sensitive-data-only-in-module
  await tx.execute(`insert into "sensitive"."health_notes" (id) values ($1)`);
  // ok: sensitive-data-only-in-module
  await tx.execute("select title from tasks.tasks");
  // ruleid: sensitive-data-only-in-module
  const url = process.env.SENSITIVE_DATABASE_URL;
  // ok: sensitive-data-only-in-module
  const appUrl = process.env.DATABASE_URL;
  // ruleid: sensitive-data-only-in-module
  const schemaName = sqlId.identifier("sensitive");
  return [health, tasksSchema, url, appUrl, schemaName, tenantKeys, createSensitiveStore, KMSClient, sensitiveOf];
}

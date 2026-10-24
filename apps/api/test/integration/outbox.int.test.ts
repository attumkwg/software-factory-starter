import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../../src/db/client.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { createLogger } from "../../src/logger.ts";
import { enqueue, type OutboxEvent, relayOnce } from "../../src/outbox/index.ts";
import {
  call,
  createTenantFixture,
  createTestApp,
  login,
  type TenantFixture,
} from "../helpers/fixtures.ts";
import { createIsolatedDatabase } from "../helpers/isolated-db.ts";

// アウトボックス(ADR 0006)が約束すること:
//   1. 業務の変更と一緒にしか積まれない(取り消されたら積まれない)
//   2. 何台で送っても、同じ物を同時に2台が取らない
//   3. 送れなければ時間をおいてやり直し、決めた回数でやめる
//   4. アプリは他社の出来事を読めない
//
// 送り出し(relayOnce)は全社分を取るので、このファイルだけの DB で流す。
// 同じ DB だと、同時に動くほかのファイルの送り出し(personal-data-logs など)と出来事を取り合い、
// 流すたびに違う所で落ちる(取られている間は見えず、ほかの宛先で「送れた」「やめた」にされる)。

const urls = await createIsolatedDatabase(inject("adminUrl"), "outbox");
const owner = createDb(urls.ownerUrl);
const appDb = createDb(urls.appUrl);
const { app, pool } = createTestApp(urls.appUrl);
const logger = createLogger({ level: "silent" });
let a: TenantFixture;
let b: TenantFixture;

beforeAll(async () => {
  a = await createTenantFixture(owner.db, "acme");
  b = await createTenantFixture(owner.db, "globex");
});
afterAll(async () => {
  await owner.pool.end();
  await appDb.pool.end();
  await pool.end();
});

const scopeOf = (t: TenantFixture, tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => ({
  tx,
  tenantId: t.tenantId,
  userId: t.users.admin.id,
});

/** 送り出しを1回回し、届いた物を返す */
async function deliver(handler?: (e: OutboxEvent) => Promise<void>) {
  const got: OutboxEvent[] = [];
  await relayOnce({
    db: appDb.db,
    logger,
    handlers: {
      "tasks.task_completed": async (e) => {
        got.push(e);
        await handler?.(e);
      },
    },
    backoffSeconds: () => 0,
    maxAttempts: 3,
  });
  return got;
}

describe("アウトボックス", () => {
  it("業務の変更が取り消されたら、出来事も積まれない(同じトランザクション)", async () => {
    await expect(
      withTenant(appDb.db, a.tenantId, async (tx) => {
        await enqueue(scopeOf(a, tx), "tasks.task_completed", {
          taskId: a.taskId,
          projectId: a.projectId,
        });
        throw new Error("途中で失敗");
      }),
    ).rejects.toThrow("途中で失敗");
    expect(await deliver()).toEqual([]);
  });

  it("API でタスクを完了にすると、出来事が1回だけ届く(もう一度完了にしても増えない)", async () => {
    const cookie = await login(app, a.users.member.email);
    for (let i = 0; i < 2; i++) {
      const res = await call(app, "PATCH", `/api/tasks/${a.taskId}`, {
        cookie,
        body: { done: true },
      });
      expect(res.status).toBe(200);
    }
    const got = await deliver();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      topic: "tasks.task_completed",
      tenantId: a.tenantId,
      payload: { taskId: a.taskId, projectId: a.projectId },
    });
    // 送れたので、次は届かない
    expect(await deliver()).toEqual([]);
  });

  it("2台が同時に送っても、同じ出来事を2台が取らない", async () => {
    for (const t of [a, b]) {
      await withTenant(appDb.db, t.tenantId, (tx) =>
        enqueue(scopeOf(t, tx), "tasks.task_completed", {
          taskId: t.taskId,
          projectId: t.projectId,
        }),
      );
    }
    const [one, two] = await Promise.all([deliver(), deliver()]);
    const ids = [...(one ?? []), ...(two ?? [])].map((e) => e.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("送れなければやり直し、決めた回数(3回)でやめる", async () => {
    await withTenant(appDb.db, b.tenantId, (tx) =>
      enqueue(scopeOf(b, tx), "tasks.task_completed", { taskId: b.taskId, projectId: b.projectId }),
    );
    const fail = async () => {
      throw new Error("宛先が止まっている");
    };
    expect(await deliver(fail)).toHaveLength(1);
    expect(await deliver(fail)).toHaveLength(1);
    expect(await deliver(fail)).toHaveLength(1);
    // 3回でやめた(dead)ので、もう取られない
    expect(await deliver()).toEqual([]);
    const { rows } = await owner.db.execute<{ dead: boolean; last_error: string }>(
      sql`select dead_at is not null as dead, last_error from platform.outbox
          where tenant_id = ${b.tenantId} order by created_at desc limit 1`,
    );
    // 失敗の文は値を伏せてから残す(日本語の並びは利用者の値でありうるので伏せる。種類は残る)
    expect(rows[0]).toMatchObject({ dead: true, last_error: "Error: […]" });
  });

  it("アプリの接続ユーザーは、出来事を直接読めない(他社の出来事が見えない)", async () => {
    await expect(
      withTenant(appDb.db, a.tenantId, (tx) => tx.execute(sql`select * from platform.outbox`)),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
  });
});

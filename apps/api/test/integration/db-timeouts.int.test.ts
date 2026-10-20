import { Writable } from "node:stream";
import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config.ts";
import { createDb, dbLogging, type SlowQuery } from "../../src/db/client.ts";
import { projects } from "../../src/db/schema.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { toApiError } from "../../src/errors.ts";
import { createLogger } from "../../src/logger.ts";
import { call, createTenantFixture, login, type TenantFixture } from "../helpers/fixtures.ts";

// DB の時間切れと遅いクエリのログ(performance.int.test.ts から分けた)。

const owner = createDb(inject("ownerUrl"));
const appDb = createDb(inject("appUrl"));
const config = loadConfig({
  APP_ENV: "test",
  DATABASE_URL: inject("appUrl"),
  SESSION_SECRET: "test-only-".padEnd(40, "x"),
});
const app = createApp({ config, db: appDb.db, logger: createLogger({ level: "silent" }) });

let a: TenantFixture;
let aAdmin: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  a = await createTenantFixture(owner.db, "acme");
  aAdmin = await login(app, a.users.admin.email);
  // 一覧が limit を超えるように(遅いクエリのログで、名前が SQL に入らないことも確かめる)
  await withTenant(owner.db, a.tenantId, (tx) =>
    tx.insert(projects).values(
      Array.from({ length: 6 }, (_, i) => ({
        id: uuidv7(),
        tenantId: a.tenantId,
        name: `同時に作った ${i}`,
        createdBy: a.users.admin.id,
      })),
    ),
  );
});
afterAll(async () => {
  await owner.pool.end();
  await appDb.pool.end();
});

describe("DB の時間切れ", () => {
  it("アプリの接続には、1つのクエリとトランザクションの放置の上限が付いている", async () => {
    const plain = createDb(inject("appUrl"));
    try {
      const show = async (name: string) =>
        (await plain.pool.query(`show ${name}`)).rows[0]?.[name] as string;
      expect(await show("statement_timeout")).toBe("5s");
      expect(await show("idle_in_transaction_session_timeout")).toBe("10s");
    } finally {
      await plain.pool.end();
    }
  });

  it("トランザクションを開いたまま止まると、DB が接続を切ってロックを放し、プロセスは落ちず、そのリクエストは 503", async () => {
    const lost: Error[] = [];
    const short = createDb(inject("appUrl"), {
      timeouts: { idleInTransactionMs: 300 },
      onActiveError: (err) => lost.push(err),
    });
    try {
      const stuck = withTenant(short.db, a.tenantId, async (tx) => {
        // 行を押さえたまま、DB 以外の所で止まる
        await tx.execute(sql`select id from tasks.tasks where id = ${a.taskId} for update`);
        await sleep(1_000);
        await tx.execute(sql`select 1`);
      });
      const err = await stuck.then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).not.toBeNull();
      expect(toApiError(err).status).toBe(503);
      expect(lost.length).toBe(1);

      // ロックは放されている(ほかのリクエストが同じ行を直せる)
      const res = await call(app, "PATCH", `/api/tasks/${a.taskId}`, {
        cookie: aAdmin,
        body: { title: "止まった人の後で直す" },
      });
      expect(res.status).toBe(200);
      // 切れた接続はプールが捨て、次は新しい接続で動く
      await withTenant(short.db, a.tenantId, (tx) => tx.execute(sql`select 1`));
      expect(short.pool.totalCount).toBe(1);
    } finally {
      await short.pool.end();
    }
  });
});

describe("遅いクエリのログ", () => {
  it("線を超えたクエリを、SQL($1 の形)・時間・リクエストの ID つきで warn に出す。値は出さない", async () => {
    const lines: Record<string, unknown>[] = [];
    const destination = new Writable({
      write(chunk, _enc, cb) {
        lines.push(JSON.parse(chunk.toString()));
        cb();
      },
    });
    const logger = createLogger({ level: "info", destination });
    const db = createDb(inject("appUrl"), { ...dbLogging(logger), slowQueryMs: 0 });
    const logged = createApp({ config, db: db.db, logger });
    try {
      const cookie = await login(logged, a.users.admin.email);
      const res = await call(logged, "GET", "/api/projects?limit=2", { cookie });
      const requestId = res.headers.get("x-request-id");
      const slow = lines.filter(
        (l) => l.message === "時間のかかったクエリがありました" && l.requestId === requestId,
      );
      const list = slow.find((l) => String(l.sql).includes('from "projects"."projects"'));
      expect(list).toMatchObject({ level: "warn", rows: 3 });
      expect(typeof list?.durationMs).toBe("number");
      expect(String(list?.sql)).toContain("$1");
      // SQL に値(テナントの ID・名前)は入らない(行の tenantId はどのログにも入る文脈の項目)
      const text = JSON.stringify(slow.map((l) => l.sql));
      expect(text).not.toContain(a.tenantId);
      expect(text).not.toContain("同時に作った");
    } finally {
      await db.pool.end();
    }
  });

  it("線より速いクエリは出さない", async () => {
    const seen: SlowQuery[] = [];
    const db = createDb(inject("appUrl"), { onSlowQuery: (q) => seen.push(q) });
    try {
      await db.pool.query("select 1");
      await db.db.execute(sql`select pg_sleep(0.6)`);
      expect(seen.map((q) => q.sql)).toEqual(["select pg_sleep(0.6)"]);
    } finally {
      await db.pool.end();
    }
  });
});

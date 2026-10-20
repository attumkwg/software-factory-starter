import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { PAGE_LIMIT } from "@app/shared";
import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config.ts";
import { createDb, dbLogging, type SlowQuery } from "../../src/db/client.ts";
import { runMigrations } from "../../src/db/migrate.ts";
import { projects, tasks } from "../../src/db/schema.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { toApiError } from "../../src/errors.ts";
import { createLogger } from "../../src/logger.ts";
import { call, createTenantFixture, login, type TenantFixture } from "../helpers/fixtures.ts";

// 速さと時間切れ: 一覧のページング・並びに合う索引・DB の時間切れ・遅いクエリのログ・圧縮と no-store。
// テストは2社で(自社の続きの印で他社の行が出ないこと)。

const owner = createDb(inject("ownerUrl"));
// アプリが投げた SQL を全部集める(線を 0ms にして「遅いクエリ」として受け取る)
const queries: SlowQuery[] = [];
const appDb = createDb(inject("appUrl"), {
  slowQueryMs: 0,
  onSlowQuery: (q) => queries.push(q),
});
const config = loadConfig({
  APP_ENV: "test",
  DATABASE_URL: inject("appUrl"),
  SESSION_SECRET: "test-only-".padEnd(40, "x"),
});
const app = createApp({ config, db: appDb.db, logger: createLogger({ level: "silent" }) });

let a: TenantFixture;
let b: TenantFixture;
let aAdmin: string;
let bAdmin: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  a = await createTenantFixture(owner.db, "acme");
  b = await createTenantFixture(owner.db, "globex");
  aAdmin = await login(app, a.users.admin.email);
  bAdmin = await login(app, b.users.admin.email);
  // 同じトランザクションで足す = created_at が全部同じ(ID で並びが決まることを確かめる)
  await withTenant(owner.db, a.tenantId, async (tx) => {
    await tx.insert(projects).values(
      Array.from({ length: 6 }, (_, i) => ({
        id: uuidv7(),
        tenantId: a.tenantId,
        name: `同時に作った ${i}`,
        createdBy: a.users.admin.id,
      })),
    );
    await tx.insert(tasks).values(
      Array.from({ length: PAGE_LIMIT.default + 5 }, (_, i) => ({
        id: uuidv7(),
        tenantId: a.tenantId,
        projectId: a.projectId,
        title: `タスク ${i}`,
      })),
    );
  });
  await withTenant(owner.db, b.tenantId, (tx) =>
    tx.insert(projects).values({
      id: uuidv7(),
      tenantId: b.tenantId,
      name: "他社の後から作った物",
      createdBy: b.users.admin.id,
    }),
  );
});
afterAll(async () => {
  await owner.pool.end();
  await appDb.pool.end();
});

type Page<K extends string> = Record<K, { id: string; createdAt: string }[]> & {
  nextCursor: string | null;
};

/** 続きの印をたどって全部読む。各ページの件数も返す */
async function readAll<K extends "projects" | "tasks">(
  cookie: string,
  path: string,
  key: K,
  limit: number,
) {
  const ids: string[] = [];
  const sizes: number[] = [];
  let cursor: string | null = null;
  do {
    const q: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const res = await call(app, "GET", `${path}?limit=${limit}${q}`, { cookie });
    expect(res.status).toBe(200);
    const page = (await res.json()) as Page<K>;
    ids.push(...page[key].map((r) => r.id));
    sizes.push(page[key].length);
    cursor = page.nextCursor;
  } while (cursor && sizes.length < 100);
  return { ids, sizes };
}

describe("一覧のページング", () => {
  it("プロジェクト: 新しい順に、抜けも重なりも無く最後まで読める(時刻が同じでも)", async () => {
    const { ids, sizes } = await readAll(aAdmin, "/api/projects", "projects", 3);
    expect(sizes).toEqual([3, 3, 1]);
    expect(new Set(ids).size).toBe(7);
    const expected = await withTenant(owner.db, a.tenantId, (tx) =>
      tx.execute<{ id: string }>(
        sql`select id from projects.projects where tenant_id = ${a.tenantId} order by created_at desc, id desc`,
      ),
    );
    expect(ids).toEqual(expected.rows.map((r) => r.id));
  });

  it("タスク: 古い順に、抜けも重なりも無く最後まで読める", async () => {
    const path = `/api/projects/${a.projectId}/tasks`;
    const { ids, sizes } = await readAll(aAdmin, path, "tasks", 20);
    expect(sizes).toEqual([20, 20, 16]);
    expect(ids[0]).toBe(a.taskId);
    expect(new Set(ids).size).toBe(56);
  });

  it("limit を渡さなければ既定の件数まで。上限を超える limit は 400", async () => {
    const res = await call(app, "GET", `/api/projects/${a.projectId}/tasks`, { cookie: aAdmin });
    const page = (await res.json()) as Page<"tasks">;
    expect(page.tasks).toHaveLength(PAGE_LIMIT.default);
    expect(page.nextCursor).not.toBeNull();

    for (const limit of [PAGE_LIMIT.max + 1, 0, -1]) {
      const over = await call(app, "GET", `/api/projects?limit=${limit}`, { cookie: aAdmin });
      expect(over.status).toBe(400);
    }
  });

  it("壊れた・ありえない続きの印は 400(500 にしない)", async () => {
    const bad = [
      "not-a-cursor",
      Buffer.from(`2026-02-30T00:00:00.000000Z|${a.projectId}`).toString("base64url"),
      Buffer.from(`2026-10-20T00:00:00.000000Z|x`).toString("base64url"),
      Buffer.from(`2026-10-20T00:00:00.000000Z|${a.projectId}|x`).toString("base64url"),
    ];
    for (const cursor of bad) {
      const res = await call(app, "GET", `/api/projects?cursor=${cursor}`, { cookie: aAdmin });
      expect(res.status).toBe(400);
    }
  });

  it("他社の続きの印を使っても、自社の行しか出ない", async () => {
    const first = await call(app, "GET", "/api/projects?limit=1", { cookie: aAdmin });
    const { nextCursor } = (await first.json()) as Page<"projects">;
    const res = await call(app, "GET", `/api/projects?cursor=${nextCursor}`, { cookie: bAdmin });
    const { projects: rows } = (await res.json()) as Page<"projects">;
    expect(rows.map((r) => r.id)).not.toContain(a.projectId);
    expect(rows.length).toBeLessThanOrEqual(2);
  });
});

describe("並びに合う索引", () => {
  // 一覧の API が実際に投げた SQL を、索引だけで並べられるか(Sort が無いか)を実行計画で確かめる
  async function planOf(path: string, table: string) {
    queries.length = 0;
    const res = await call(app, "GET", path, { cookie: aAdmin });
    expect(res.status).toBe(200);
    const list = queries.find(
      (q) => q.sql.includes(`from "${table}"`) && q.sql.includes("order by"),
    );
    if (!list) throw new Error(`一覧の SQL が見つかりません: ${table}`);
    // 値の無い SQL($1 のまま)の計画を見る。行が少ないと全部読む方が速いと判断されるので、
    // 全部読むのを止めて「索引だけで並べられる形か」を見る
    const client = await owner.pool.connect();
    try {
      await client.query("begin");
      await client.query("set local enable_seqscan = off");
      const { rows } = await client.query(`explain (generic_plan, format json) ${list.sql}`);
      return JSON.stringify(rows);
    } finally {
      await client.query("rollback");
      client.release();
    }
  }

  it("プロジェクトの一覧(続きの印つき)", async () => {
    const first = await call(app, "GET", "/api/projects?limit=1", { cookie: aAdmin });
    const { nextCursor } = (await first.json()) as Page<"projects">;
    const plan = await planOf(`/api/projects?limit=2&cursor=${nextCursor}`, "projects");
    expect(plan).toContain("projects_tenant_id_created_at_id_idx");
    expect(plan).not.toContain('"Node Type":"Sort"');
  });

  it("タスクの一覧(続きの印つき)", async () => {
    const path = `/api/projects/${a.projectId}/tasks`;
    const first = await call(app, "GET", `${path}?limit=1`, { cookie: aAdmin });
    const { nextCursor } = (await first.json()) as Page<"tasks">;
    const plan = await planOf(`${path}?limit=2&cursor=${nextCursor}`, "tasks");
    expect(plan).toContain("tasks_tenant_id_project_id_created_at_id_idx");
    expect(plan).not.toContain('"Node Type":"Sort"');
  });

  it("索引は書き込みを止めずに(トランザクションの外で)作られ、使える状態になっている", async () => {
    const { rows } = await owner.pool.query<{ relname: string; indisvalid: boolean }>(
      `select c.relname, i.indisvalid from pg_index i join pg_class c on c.oid = i.indexrelid
        where c.relname in ('projects_tenant_id_created_at_id_idx', 'tasks_tenant_id_project_id_created_at_id_idx')
        order by c.relname`,
    );
    expect(rows).toEqual([
      { relname: "projects_tenant_id_created_at_id_idx", indisvalid: true },
      { relname: "tasks_tenant_id_project_id_created_at_id_idx", indisvalid: true },
    ]);
    const applied = await owner.pool.query("select name from drizzle.concurrent_migrations");
    expect(applied.rows.map((r) => r.name)).toContain("0008_list_indexes.sql");
  });

  it("途中で失敗して使えない索引が残っていても、次の移行で作り直す。もう一度流しても変わらない", async () => {
    const name = "perf_test_retry_idx";
    // 一意にできない列に一意の索引 → CONCURRENTLY が途中で落ちて、使えない索引が残る
    await expect(
      owner.pool.query(`create unique index concurrently "${name}" on tasks.tasks (tenant_id)`),
    ).rejects.toThrow();
    const left = await owner.pool.query(
      "select i.indisvalid from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname = $1",
      [name],
    );
    expect(left.rows).toEqual([{ indisvalid: false }]);

    const dir = mkdtempSync(join(tmpdir(), "migrations-"));
    try {
      cpSync(fileURLToPath(new URL("../../drizzle", import.meta.url)), dir, { recursive: true });
      writeFileSync(
        join(dir, "concurrent", "9999_perf_test.sql"),
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${name}" ON "tasks"."tasks" USING btree ("tenant_id");`,
      );
      await runMigrations(inject("ownerUrl"), dir);
      await runMigrations(inject("ownerUrl"), dir);
      const now = await owner.pool.query(
        "select i.indisvalid, i.indisunique from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname = $1",
        [name],
      );
      expect(now.rows).toEqual([{ indisvalid: true, indisunique: false }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await owner.pool.query(`drop index concurrently if exists tasks."${name}"`);
      await owner.pool.query("delete from drizzle.concurrent_migrations where name = $1", [
        "9999_perf_test.sql",
      ]);
    }
  });
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

describe("応答の圧縮と Cache-Control", () => {
  it("gzip を受け取れる相手には JSON を縮めて返す。ログイン後の応答は no-store", async () => {
    const res = await call(app, "GET", `/api/projects/${a.projectId}/tasks`, {
      cookie: aAdmin,
      headers: { "accept-encoding": "gzip, deflate, br" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("vary")).toMatch(/accept-encoding/i);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = res.body?.pipeThrough(new DecompressionStream("gzip"));
    const page = (await new Response(body).json()) as Page<"tasks">;
    expect(page.tasks).toHaveLength(PAGE_LIMIT.default);
  });

  it("受け取れない相手には縮めない", async () => {
    const res = await call(app, "GET", "/api/projects", { cookie: aAdmin });
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(((await res.json()) as Page<"projects">).projects.length).toBeGreaterThan(0);
  });

  it("失敗の応答(401)にも no-store が付く。書き出しは自分の no-store のまま", async () => {
    const anon = await call(app, "GET", "/api/projects");
    expect(anon.status).toBe(401);
    expect(anon.headers.get("cache-control")).toBe("no-store");
    const exported = await call(app, "POST", "/api/exports", { cookie: aAdmin });
    expect(exported.status).toBe(200);
    expect(exported.headers.get("cache-control")).toBe("no-store");
  });
});

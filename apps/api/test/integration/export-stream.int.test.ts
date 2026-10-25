import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { EXPORT_FORMAT, type ExportData } from "@app/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config.ts";
import { createDb } from "../../src/db/client.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { EXPORT_PAGE_SIZE } from "../../src/export/stream.ts";
import { createLogger } from "../../src/logger.ts";
import { call, createTenantFixture, login, type TenantFixture } from "../helpers/fixtures.ts";
import { createIsolatedDatabase } from "../helpers/isolated-db.ts";

// 大きい組織の書き出し(docs/specs/0018-export-stream.md・ADR 0031)。
// 1社の全部をメモリに載せず、少しずつ流すこと・受け手が遅くても切れないこと・中身が欠けず重ならないことを確かめる。
// 数万行を足すので、ほかのファイルと同じ DB を使わない(自分だけの DB)。

// 測る前にごみを片づける(--expose-gc を付けずに、このファイルの中だけで gc を呼べるようにする)
setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

const TASKS = 30_000;
const AUDIT_EVENTS = 10_000;
/** 1行を大きめにする(題名は 200 字まで。ここは 120 字 ≒ 360 バイト) */
const TITLE = "大きい会社のタスク".padEnd(120, "あ");
/** 受け手が止まっていてよい時間を、トランザクションを開いたまま待てる上限より長くする */
const IDLE_IN_TRANSACTION_MS = 1_000;

let dbs: Awaited<ReturnType<typeof createIsolatedDatabase>>;
let owner: ReturnType<typeof createDb>;
let appDb: ReturnType<typeof createDb>;
let app: ReturnType<typeof createApp>;
let a: TenantFixture;
let b: TenantFixture;
let aAdmin: string;
let bAdmin: string;

beforeAll(async () => {
  dbs = await createIsolatedDatabase(inject("adminUrl"), "export");
  owner = createDb(dbs.ownerUrl);
  // トランザクションを開いたまま待てる時間を短くする(受け手が遅いときに、開いたまま待っていれば切られる)
  appDb = createDb(dbs.appUrl, { timeouts: { idleInTransactionMs: IDLE_IN_TRANSACTION_MS } });
  const config = loadConfig({
    APP_ENV: "test",
    DATABASE_URL: dbs.appUrl,
    SESSION_SECRET: "test-only-".padEnd(40, "x"),
  });
  app = createApp({ config, db: appDb.db, logger: createLogger({ level: "silent" }) });
  a = await createTenantFixture(owner.db, "acme");
  b = await createTenantFixture(owner.db, "globex");
  // a に、プロジェクト3つにまたがるタスクと監査ログを大量に足す(作った時刻が同じ行も混ぜる)
  await withTenant(owner.db, a.tenantId, async (tx) => {
    await tx.execute(sql`
      insert into projects.projects (id, tenant_id, name, created_by)
      select gen_random_uuid(), ${a.tenantId}, '大きいプロジェクト ' || i, ${a.users.admin.id}
      from generate_series(1, 2) as i`);
    await tx.execute(sql`
      insert into tasks.tasks (id, tenant_id, project_id, title, created_at)
      select gen_random_uuid(), ${a.tenantId}, p.id, ${TITLE} || ' ' || i,
             now() - ((i / 3) || ' ms')::interval
      from generate_series(1, ${TASKS}) as i
      join lateral (
        select id from projects.projects where tenant_id = ${a.tenantId}
        order by created_at, id offset (i % 3) limit 1
      ) p on true`);
    // 監査ログは ID(UUIDv7 = 時刻の順)で並ぶので、アプリが後で残す行より古い ID にする
    await tx.execute(sql`
      insert into platform.audit_events (id, tenant_id, actor_kind, actor_id, action, target_type, target_id, outcome)
      select ('00000000-0000-7000-8000-' || lpad(to_hex(i), 12, '0'))::uuid, ${a.tenantId}, 'user',
             ${a.users.admin.id}, 'task.update', 'task', ${a.taskId}, 'allowed'
      from generate_series(1, ${AUDIT_EVENTS}) as i`);
  });
  aAdmin = await login(app, a.users.admin.email);
  bAdmin = await login(app, b.users.admin.email);
}, 180_000);

afterAll(async () => {
  await owner?.pool.end();
  await appDb?.pool.end();
});

/**
 * heap … JS の値(1社の全部を載せれば、ここが中身の大きさだけ増える)。
 * buffers … 通信の受け渡しの場所(pg・Node の外のメモリ)。片づけが遅れて数 MB の間で上下するが、中身に比例しない。
 */
const memory = () => {
  const m = process.memoryUsage();
  return { heap: m.heapUsed, buffers: m.arrayBuffers };
};

/** 本文を少しずつ読んで捨てながら、量・時間・メモリを測る(受け取った分は持ち続けない) */
async function measure(res: Response, started: number, base: ReturnType<typeof memory>) {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const m = {
    bytes: 0,
    chunks: 0,
    found: 0,
    peakHeap: 0,
    peakBuffers: 0,
    firstByteMs: 0,
    maxGapMs: 0,
  };
  let last = performance.now();
  // 題名の印を数える(チャンクの境目で切れた印も数えるよう、前のチャンクの終わりを少し持ち越す)
  const marker = "大きい会社のタスク";
  let carry = "";
  for (;;) {
    const { done, value } = await reader.read();
    const now = performance.now();
    if (done) break;
    if (m.chunks === 0) m.firstByteMs = now - started;
    m.maxGapMs = Math.max(m.maxGapMs, now - last);
    m.bytes += value.byteLength;
    m.chunks += 1;
    const text = carry + decoder.decode(value, { stream: true });
    m.found += text.split(marker).length - 1;
    carry = text.slice(-(marker.length - 1));
    // 何回かに1回、片づけてから測る
    if (m.chunks % 10 === 0) {
      gc();
      const now = memory();
      m.peakHeap = Math.max(m.peakHeap, now.heap - base.heap);
      m.peakBuffers = Math.max(m.peakBuffers, now.buffers - base.buffers);
    }
    last = performance.now();
  }
  return { ...m, totalMs: performance.now() - started };
}

describe("大きい組織の書き出し(メモリと時間)", () => {
  it("少しずつ流れ、メモリは中身の大きさに比例して増えない。途中で止まる時間は ALB の60秒よりずっと短い", async () => {
    // 初めての呼び出しで増える分(コードの読み込み・接続)を測りに入れないよう、先に小さい組織で1回流す
    await (await call(app, "POST", "/api/exports", { cookie: bAdmin })).text();
    gc();
    const base = memory();
    const started = performance.now();
    const res = await call(app, "POST", "/api/exports", { cookie: aAdmin });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="export-/);
    const m = await measure(res, started, base);
    console.info(m);

    expect(m.found).toBe(TASKS);
    // 1ページずつ流れている(ページの数より多くのチャンクに分かれている)
    expect(m.chunks).toBeGreaterThan((TASKS + AUDIT_EVENTS) / EXPORT_PAGE_SIZE);
    expect(m.bytes).toBeGreaterThan(15 * 1024 * 1024);
    // 全部を載せていれば、JS の値が中身(UTF-8 で 15MB 超・JS の文字列ではその倍近く)以上に増える。
    // 1ページずつなら、増えるのはほぼ1ページ分(手元で 0.3MB ほど)
    expect(m.peakHeap).toBeLessThan(4 * 1024 * 1024);
    expect(m.peakHeap).toBeLessThan(m.bytes / 10);
    expect(m.peakBuffers).toBeLessThan(16 * 1024 * 1024);
    expect(m.firstByteMs).toBeLessThan(5_000);
    expect(m.maxGapMs).toBeLessThan(5_000);
    expect(m.totalMs).toBeLessThan(60_000);
  }, 120_000);
});

describe("大きい組織の書き出し(中身と流し方)", () => {
  it("中身は欠けず重ならず、他社の物は入らない(ページの境目・プロジェクトの境目・同じ時刻の行があっても)", async () => {
    const res = await call(app, "POST", "/api/exports", { cookie: aAdmin });
    const data = JSON.parse(await res.text()) as ExportData;
    expect(data.format).toBe(EXPORT_FORMAT);
    expect(data.organization.id).toBe(a.tenantId);

    const expected = await withTenant(owner.db, a.tenantId, async (tx) => ({
      tasks: (
        await tx.execute<{ id: string }>(
          sql`select id from tasks.tasks where tenant_id = ${a.tenantId} order by project_id, created_at, id`,
        )
      ).rows.map((r) => r.id),
      audit: (
        await tx.execute<{ n: number }>(
          sql`select count(*)::int as n from platform.audit_events where tenant_id = ${a.tenantId}`,
        )
      ).rows[0]?.n,
    }));
    const taskIds = data.tasks.map((t) => t.id);
    expect(taskIds).toEqual(expected.tasks);
    expect(new Set(data.auditEvents.map((e) => e.id)).size).toBe(data.auditEvents.length);
    // 書き出した事実(data.export)は流し始める前に残るので、その分も入る
    expect(data.auditEvents.length).toBe(expected.audit);
    expect(data.auditEvents[0]?.action).toBe("data.export");
    expect(data.projects).toHaveLength(3);
    expect(data.users.map((u) => u.id).sort()).toEqual(
      Object.values(a.users)
        .map((u) => u.id)
        .sort(),
    );

    const text = JSON.stringify(data);
    expect(text).not.toContain(b.tenantId);
    expect(text).not.toContain(b.projectId);
    expect(text).not.toContain(b.users.admin.email);
  }, 120_000);

  it("受け手が止まっても切れない(ページの間はトランザクションを開いたまま待たない)", async () => {
    const res = await call(app, "POST", "/api/exports", { cookie: aAdmin });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const parts: Uint8Array[] = [];
    for (let i = 0; ; i++) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      // 最初の何ページかで、トランザクションを開いたまま待てる時間より長く止まる
      if (i < 3) await new Promise((r) => setTimeout(r, IDLE_IN_TRANSACTION_MS * 1.5));
    }
    const data = JSON.parse(Buffer.concat(parts).toString("utf8")) as ExportData;
    expect(data.tasks.length).toBeGreaterThan(TASKS);
  }, 120_000);

  it("途中でやめれば、残りのページは読まない(接続を返す)", async () => {
    const res = await call(app, "POST", "/api/exports", { cookie: aAdmin });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    await reader.cancel();
    // 使っている接続が残っていない(全部の接続が空いている)
    await expect.poll(() => appDb.pool.totalCount - appDb.pool.idleCount).toBe(0);
  });

  it("gzip を受け取れる相手には縮めて流す(小さい組織も同じ形)", async () => {
    const res = await call(app, "POST", "/api/exports", {
      cookie: bAdmin,
      headers: { "accept-encoding": "gzip" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    const body = (res.body as ReadableStream<Uint8Array>).pipeThrough(
      new DecompressionStream("gzip"),
    );
    const data = (await new Response(body).json()) as ExportData;
    expect(data.organization.id).toBe(b.tenantId);
    expect(data.tasks.map((t) => t.id)).toEqual([b.taskId]);
    expect(JSON.stringify(data)).not.toContain(a.tenantId);
  });
});

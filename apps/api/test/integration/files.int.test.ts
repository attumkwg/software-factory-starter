import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config.ts";
import { createDb } from "../../src/db/client.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { handleFileDeleted, handleFileUploaded } from "../../src/domains/files/index.ts";
import { createLogger } from "../../src/logger.ts";
import type { OutboxEvent, OutboxTopic } from "../../src/outbox/index.ts";
import { orientationOnlyExif } from "../../src/storage/strip-metadata.ts";
import {
  call,
  createFileFixture,
  createTenantFixture,
  login,
  type TenantFixture,
} from "../helpers/fixtures.ts";
import { memoryObjectStore } from "../helpers/memory-store.ts";

// 写真・ファイル(docs/specs/0072-file-storage.md)。2社で、置き場の URL がいつもセッションの組織の置き場だけを指すこと・
// 自分の物 / 同じ会社の他人の物 / 他社の物・タスクを消すと中身も消える・上げた物を確かめて付いた情報を消す・
// ログに名前と URL が出ないこと。置き場はメモリの中の偽物(本物と同じ取り決めは files-object-store.int.test.ts)。

const lines: string[] = [];
const logger = createLogger({ level: "trace", destination: { write: (l) => lines.push(l) } });
const appUrl = inject("appUrl");
const owner = createDb(inject("ownerUrl"));
const appDb = createDb(appUrl);
const store = memoryObjectStore();
const app = createApp({
  config: loadConfig({
    APP_ENV: "test",
    DATABASE_URL: appUrl,
    SESSION_SECRET: "test-only-".padEnd(40, "x"),
  }),
  db: appDb.db,
  logger,
  lifecycle: { shuttingDown: false },
  files: store,
});
const uploaded = handleFileUploaded({
  inTenant: (tenantId, fn) => withTenant(owner.db, tenantId, fn),
  logger,
  store,
});
const deleted = handleFileDeleted({ store });

const NAME = "施主の山田様邸.jpg";
let a: TenantFixture;
let b: TenantFixture;
const cookies: Record<string, string> = {};

beforeAll(async () => {
  a = await createTenantFixture(owner.db, "files-a");
  b = await createTenantFixture(owner.db, "files-b");
  for (const [key, email] of [
    ["aAdmin", a.users.admin.email],
    ["aMember", a.users.member.email],
    ["aViewer", a.users.viewer.email],
    ["bAdmin", b.users.admin.email],
  ] as const) {
    cookies[key] = await login(app, email);
  }
});
afterAll(async () => {
  await owner.pool.end();
  await appDb.pool.end();
});

async function outboxOf(tenantId: string, topic: OutboxTopic): Promise<OutboxEvent[]> {
  const r = await withTenant(owner.db, tenantId, (tx) =>
    tx.execute<{ id: string; payload: unknown; attempts: number; created_at: Date }>(
      sql`select id, payload, attempts, created_at from platform.outbox
        where tenant_id = ${tenantId} and topic = ${topic} order by created_at`,
    ),
  );
  return r.rows.map((e) => ({
    id: e.id,
    tenantId,
    topic,
    payload: e.payload,
    attempts: e.attempts,
    createdAt: new Date(e.created_at),
  }));
}

const eventFor = (tenantId: string, topic: OutboxTopic, fileId: string): OutboxEvent => ({
  id: crypto.randomUUID(),
  tenantId,
  topic,
  payload: { fileId },
  attempts: 1,
  createdAt: new Date(),
});

/** 位置情報(GPS の印の文字列)と向き 6 の入った、小さな JPEG */
function jpegWithGps(): Uint8Array {
  const gps = [..."Exif\0\0MM\0*GPS-35.6895N-139.6917E"].map((c) => c.charCodeAt(0));
  const app1 = [0xff, 0xe1, 0, gps.length + 2, ...gps];
  const orientation = [...orientationOnlyExif(6)];
  const sos = [0xff, 0xda, 0, 3, 1, 0x12, 0x34, 0xff, 0xd9];
  return Uint8Array.from([0xff, 0xd8, ...orientation, ...app1, ...sos]);
}

async function startUpload(cookie: string, f: TenantFixture, byteSize: number) {
  const res = await call(app, "POST", `/api/tasks/${f.taskId}/files`, {
    cookie,
    body: { name: NAME, contentType: "image/jpeg", byteSize },
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as { id: string; status: string; upload: { url: string } };
}

describe("上げる・確かめる・見る", () => {
  it("上げる URL はセッションの組織の incoming を指し、上げ終えると位置情報を消して ready になる", async () => {
    const body = jpegWithGps();
    const created = await startUpload(cookies.aMember as string, a, body.length);
    expect(created.status).toBe("pending");
    expect(created.upload.url).toContain(`/incoming/${a.tenantId}/${created.id}`);

    store.upload(a.tenantId, created.id, body);
    const done = await call(app, "POST", `/api/files/${created.id}/complete`, {
      cookie: cookies.aMember,
    });
    expect(done.status).toBe(202);
    const [event] = (await outboxOf(a.tenantId, "files.file_uploaded")).filter(
      (e) => (e.payload as { fileId: string }).fileId === created.id,
    );
    if (!event) throw new Error("files.file_uploaded が積まれていません");
    await uploaded(event);
    await uploaded(event); // 2回届いても同じ

    const shown = store.objects.get(`files/${a.tenantId}/${created.id}`);
    if (!shown) throw new Error("見せる置き場に書かれていません");
    expect(Buffer.from(shown.body).includes("GPS-35.6895N")).toBe(false);
    expect(Buffer.from(shown.body).includes(Buffer.from(orientationOnlyExif(6)))).toBe(true);
    expect(shown.contentDisposition).toBe(`inline; filename*=UTF-8''${encodeURIComponent(NAME)}`);
    expect(store.objects.has(`incoming/${a.tenantId}/${created.id}`)).toBe(false);

    const one = await call(app, "GET", `/api/files/${created.id}`, { cookie: cookies.aViewer });
    const view = (await one.json()) as { status: string; downloadUrl?: string };
    expect(view.status).toBe("ready");
    expect(view.downloadUrl).toContain(`/files/${a.tenantId}/${created.id}`);

    const list = await call(app, "GET", `/api/tasks/${a.taskId}/files`, {
      cookie: cookies.aViewer,
    });
    const page = (await list.json()) as { files: { id: string }[] };
    expect(page.files.map((f) => f.id)).toContain(created.id);
  });

  it.each([
    ["中身の種類が違う(HTML を写真と言った)", new TextEncoder().encode("<html><script>x</script>")],
    ["壊れた JPEG", Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff])],
  ])("%s物は断り、中身を消す", async (_label, body) => {
    const created = await startUpload(cookies.aMember as string, a, body.length);
    store.upload(a.tenantId, created.id, body);
    await uploaded(eventFor(a.tenantId, "files.file_uploaded", created.id));
    const res = await call(app, "GET", `/api/files/${created.id}`, { cookie: cookies.aMember });
    expect(((await res.json()) as { status: string }).status).toBe("rejected");
    expect(store.objects.has(`incoming/${a.tenantId}/${created.id}`)).toBe(false);
    expect(store.objects.has(`files/${a.tenantId}/${created.id}`)).toBe(false);
  });

  it("言った大きさと違う・上げていない物は断る", async () => {
    const small = await startUpload(cookies.aMember as string, a, 999);
    store.upload(a.tenantId, small.id, jpegWithGps());
    await uploaded(eventFor(a.tenantId, "files.file_uploaded", small.id));
    const missing = await startUpload(cookies.aMember as string, a, 10);
    await uploaded(eventFor(a.tenantId, "files.file_uploaded", missing.id));
    for (const id of [small.id, missing.id]) {
      const res = await call(app, "GET", `/api/files/${id}`, { cookie: cookies.aMember });
      expect(((await res.json()) as { status: string }).status).toBe("rejected");
    }
  });

  it("決めた種類・大きさの外は 400", async () => {
    for (const body of [
      { name: "x.svg", contentType: "image/svg+xml", byteSize: 10 },
      { name: "x.jpg", contentType: "image/jpeg", byteSize: 20 * 1024 * 1024 + 1 },
      { name: "", contentType: "image/jpeg", byteSize: 10 },
    ]) {
      const res = await call(app, "POST", `/api/tasks/${a.taskId}/files`, {
        cookie: cookies.aMember,
        body,
      });
      expect(res.status).toBe(400);
    }
  });
});

describe("自分の物・同じ会社の他人の物・他社の物", () => {
  it("member は他人の物を上げ終えられない・消せない。admin は消せる", async () => {
    const adminsFile = await createFileFixture(owner.db, a, a.users.admin.id, "pending");
    const complete = await call(app, "POST", `/api/files/${adminsFile}/complete`, {
      cookie: cookies.aMember,
    });
    expect(complete.status).toBe(403);
    const del = await call(app, "DELETE", `/api/files/${adminsFile}`, { cookie: cookies.aMember });
    expect(del.status).toBe(403);

    const membersFile = await createFileFixture(owner.db, a, a.users.member.id);
    const adminComplete = await call(app, "POST", `/api/files/${membersFile}/complete`, {
      cookie: cookies.aAdmin,
    });
    expect(adminComplete.status).toBe(403);
    const adminDelete = await call(app, "DELETE", `/api/files/${membersFile}`, {
      cookie: cookies.aAdmin,
    });
    expect(adminDelete.status).toBe(204);
  });

  it("他社の人は、ID を知っていても一覧・1件・上げる・上げ終える・消すのどれも 404。URL は出ない", async () => {
    const fileId = await createFileFixture(owner.db, a, a.users.admin.id);
    const before = store.signedKeys.length;
    const attempts = [
      ["GET", `/api/tasks/${a.taskId}/files`, undefined],
      [
        "POST",
        `/api/tasks/${a.taskId}/files`,
        { name: "x.jpg", contentType: "image/jpeg", byteSize: 1 },
      ],
      ["GET", `/api/files/${fileId}`, undefined],
      ["POST", `/api/files/${fileId}/complete`, undefined],
      ["DELETE", `/api/files/${fileId}`, undefined],
    ] as const;
    for (const [method, path, body] of attempts) {
      const res = await call(app, method, path, { cookie: cookies.bAdmin, body });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    expect(store.signedKeys.length).toBe(before);
  });

  it("署名した URL は、どれもセッションの組織の置き場の中だけを指す", async () => {
    await startUpload(cookies.bAdmin as string, b, 10);
    await call(app, "GET", `/api/tasks/${a.taskId}/files`, { cookie: cookies.aAdmin });
    await call(app, "GET", `/api/tasks/${b.taskId}/files`, { cookie: cookies.bAdmin });
    expect(store.signedKeys.length).toBeGreaterThan(0);
    for (const key of store.signedKeys) {
      expect(key).toMatch(new RegExp(`^(incoming|files)/(${a.tenantId}|${b.tenantId})/`));
    }
    const bKeys = store.signedKeys.filter((k) => k.includes(b.tenantId));
    expect(bKeys.every((k) => !k.includes(a.tenantId))).toBe(true);
  });
});

describe("消す", () => {
  it("タスクを消すと、ファイルの行が消えて中身を消す出来事が積まれる", async () => {
    const c = await createTenantFixture(owner.db, "files-c");
    const cookie = await login(app, c.users.admin.email);
    const fileId = await createFileFixture(owner.db, c, c.users.admin.id);
    store.objects.set(`files/${c.tenantId}/${fileId}`, { body: Uint8Array.from([1]) });

    const res = await call(app, "DELETE", `/api/tasks/${c.taskId}`, { cookie });
    expect(res.status).toBe(204);
    const events = await outboxOf(c.tenantId, "files.file_deleted");
    expect(events.map((e) => e.payload)).toEqual([{ fileId }]);
    for (const e of events) await deleted(e);
    expect(store.objects.has(`files/${c.tenantId}/${fileId}`)).toBe(false);
  });

  it("書き直している間に消された物は、書いた中身も消す", async () => {
    const body = jpegWithGps();
    const created = await startUpload(cookies.aMember as string, a, body.length);
    store.upload(a.tenantId, created.id, body);
    const del = await call(app, "DELETE", `/api/files/${created.id}`, { cookie: cookies.aMember });
    expect(del.status).toBe(204);
    // 行が無いので何もしない(引き金の出来事が中身を消す)
    await uploaded(eventFor(a.tenantId, "files.file_uploaded", created.id));
    expect(store.objects.has(`files/${a.tenantId}/${created.id}`)).toBe(false);
  });
});

describe("書き出し", () => {
  it("自社のファイルの一覧が入り、他社の物・キー・URL は入らない", async () => {
    const mine = await createFileFixture(owner.db, a, a.users.member.id);
    const theirs = await createFileFixture(owner.db, b, b.users.member.id);
    const res = await call(app, "POST", "/api/exports", { cookie: cookies.aAdmin });
    expect(res.status).toBe(200);
    const text = await res.text();
    const data = JSON.parse(text) as { files: { id: string; name: string }[] };
    expect(data.files.map((f) => f.id)).toContain(mine);
    expect(data.files.map((f) => f.id)).not.toContain(theirs);
    expect(text).not.toContain(`files/${a.tenantId}/`);
    expect(text).not.toContain("X-Amz-Signature");
  });
});

describe("記録とログ", () => {
  it("監査ログに上げる・上げ終える・消すが残り、名前は残らない", async () => {
    const r = await withTenant(owner.db, a.tenantId, (tx) =>
      tx.execute<{ action: string; details: unknown }>(
        sql`select action, details from platform.audit_events
          where tenant_id = ${a.tenantId} and action like 'file.%'`,
      ),
    );
    const actions = new Set(r.rows.map((row) => row.action));
    expect(actions).toEqual(new Set(["file.create", "file.complete", "file.delete"]));
    expect(JSON.stringify(r.rows)).not.toContain(NAME);
  });

  it("ログに名前・署名つき URL・キーが出ない", () => {
    const all = lines.join("\n");
    expect(lines.length).toBeGreaterThan(10);
    expect(all).not.toContain(NAME);
    expect(all).not.toContain("X-Amz-Signature");
    // キーの頭(<段>/<組織の ID>/)。API のパス(/api/files/<ファイルの ID>)とは違う
    for (const t of [a.tenantId, b.tenantId]) {
      expect(all).not.toContain(`incoming/${t}/`);
      expect(all).not.toContain(`files/${t}/`);
    }
  });
});

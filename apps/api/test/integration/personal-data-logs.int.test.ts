import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config.ts";
import { createDb } from "../../src/db/client.ts";
import { projects, tasks, tenants, users } from "../../src/db/schema.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { createLogger } from "../../src/logger.ts";
import { outboxHandlers, relayOnce } from "../../src/outbox/index.ts";
import { both, createCognitoApp, logIn, reauth, signUp } from "../helpers/cognito.ts";
import {
  call,
  createFileFixture,
  createTenantFixture,
  login,
  type TenantFixture,
} from "../helpers/fixtures.ts";
import { ACTORS, loadMatrix, type MatrixActor } from "../helpers/matrix.ts";
import { memoryObjectStore } from "../helpers/memory-store.ts";

// ログに個人情報が出ないことを、全部の API で確かめる(docs/specs/0008-personal-data.md の B)。
// 目印つきの値(名前・電話番号・病名に見立てた文・メールアドレス)を DB と本文とパスに入れ、
// 権限の表の全行 × 全ロールと、Cognito の手順・送信待ちの送り出し・DB の失敗を通す。
// 出たログの全行に、目印が1つでもあれば落とす。

const NAME = "テスト太郎";
const PHONE = "090-0000-0000";
const DISEASE = "病名テスト";
const MARKED = `${NAME} ${PHONE} ${DISEASE}`;
const markedEmail = (s: string) => `taro.marker.${s}@marker.test`;

const lines: string[] = [];
const logger = createLogger({ level: "trace", destination: { write: (l) => lines.push(l) } });
const appUrl = inject("appUrl");
const owner = createDb(inject("ownerUrl"));
const appDb = createDb(appUrl);
const app = createApp({
  config: loadConfig({
    APP_ENV: "test",
    DATABASE_URL: appUrl,
    SESSION_SECRET: "test-only-".padEnd(40, "x"),
  }),
  db: appDb.db,
  logger,
  lifecycle: { shuttingDown: false },
  // 写真・ファイルの API も通す(ファイルの名前は目印。docs/specs/0072-file-storage.md)
  files: memoryObjectStore(),
});
const cognito = createCognitoApp(appUrl);
/** 目印の一覧(名前・電話・病名と、作った人たちのメールアドレス) */
const markers = new Set([NAME, PHONE, DISEASE]);

afterAll(async () => {
  await owner.pool.end();
  await appDb.pool.end();
  await cognito.pool.end();
});

/** 1社を作り、名前・題名を目印の値にする */
async function markedTenant(label: string): Promise<TenantFixture> {
  const f = await createTenantFixture(owner.db, label);
  for (const u of Object.values(f.users)) markers.add(u.email);
  await withTenant(owner.db, f.tenantId, async (tx) => {
    await tx
      .update(tenants)
      .set({ name: `${NAME}商店` })
      .where(eq(tenants.tenantId, f.tenantId));
    await tx.update(users).set({ name: MARKED }).where(eq(users.tenantId, f.tenantId));
    await tx
      .update(projects)
      .set({ name: `${DISEASE}の記録` })
      .where(eq(projects.id, f.projectId));
    await tx.update(tasks).set({ title: MARKED }).where(eq(tasks.id, f.taskId));
  });
  return f;
}

/** 本文の文字列を全部、目印の値に置き換える(メールの項目はメールの形のまま) */
function markBody(body: unknown): unknown {
  if (typeof body === "string") return body.includes("@") ? markedEmail("body") : MARKED;
  if (Array.isArray(body)) return body.map(markBody);
  if (body && typeof body === "object")
    return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, markBody(v)]));
  return body;
}

const fill = (template: string, self: TenantFixture) =>
  template
    .replaceAll("{projectId}", self.projectId)
    .replaceAll("{taskId}", self.taskId)
    .replaceAll("{grantId}", self.supportGrantId)
    .replaceAll("{adminEmail}", self.users.admin.email);

/** {fileId} を、名前が目印のファイル(自社の管理者が上げた)にする(docs/specs/0072-file-storage.md) */
const withFile = async (template: string, self: TenantFixture) =>
  template.includes("{fileId}")
    ? template.replaceAll(
        "{fileId}",
        await createFileFixture(owner.db, self, self.users.admin.id, "ready", MARKED),
      )
    : template;

beforeAll(() => {
  markers.add(markedEmail("body"));
  markers.add(markedEmail("new"));
});

describe("ログに個人情報が出ない", () => {
  it("権限の表の全行を、全ロールで・目印の本文でも叩く", async () => {
    const other = await markedTenant("other");
    const otherCookie = await login(app, other.users.admin.email);
    const cookieFor = (actor: MatrixActor, self: TenantFixture) =>
      actor === "anonymous"
        ? undefined
        : actor === "other_tenant"
          ? otherCookie
          : login(app, self.users[actor].email);
    for (const row of loadMatrix().filter((r) => r.only_in !== "cognito")) {
      const [method = "", path = ""] = row.route.split(" ");
      for (const actor of ACTORS) {
        const self = await markedTenant("self");
        const body = row.body && JSON.parse(fill(JSON.stringify(row.body), self));
        const cookie = await cookieFor(actor, self);
        const filled = fill(await withFile(path, self), self);
        await call(app, method, filled, { cookie, body });
        if (row.body) await call(app, method, filled, { cookie, body: markBody(body) });
      }
    }
    expect(lines.length).toBeGreaterThan(100);
  });

  it("パスと検索の値に目印を入れても出ない", async () => {
    const self = await markedTenant("path");
    const cookie = await login(app, self.users.admin.email);
    const v = encodeURIComponent(MARKED);
    await call(app, "GET", `/api/projects/${v}`, { cookie });
    await call(app, "GET", `/api/projects/${encodeURIComponent(markedEmail("body"))}/tasks`, {
      cookie,
    });
    await call(app, "GET", `/api/projects?cursor=${v}&limit=${v}`, { cookie });
    await call(app, "GET", `/${v}`, { cookie });
  });

  it("Cognito の手順(登録・ログイン・失敗・メールアドレスの変更)", async () => {
    const f = await markedTenant("cognito");
    const email = f.users.admin.email;
    await signUp(cognito, email);
    await call(cognito.app, "POST", "/api/auth/login", {
      body: { email: markedEmail("body"), password: MARKED },
    });
    const sid = await logIn(cognito, email);
    const ticket = await reauth(cognito, sid);
    const next = markedEmail("new");
    await call(cognito.app, "POST", "/api/account/email", {
      cookie: both(sid, ticket),
      body: { newEmail: next },
    });
    await call(cognito.app, "POST", "/api/account/email/confirm", {
      cookie: both(sid, ticket),
      body: { code: cognito.fake.lastCode(next) },
    });
    for (const row of loadMatrix().filter((r) => r.only_in === "cognito")) {
      const [method = "", path = ""] = row.route.split(" ");
      await call(cognito.app, method, path, { cookie: sid, body: markBody(row.body) });
    }
    lines.push(...cognito.logs);
  });

  it("送信待ちの送り出し: 送れなかった文(宛先が入る)はログにも last_error にも出ない", async () => {
    const f = await markedTenant("relay");
    const member = await login(app, f.users.member.email);
    await call(app, "PATCH", `/api/tasks/${f.taskId}`, { cookie: member, body: { done: true } });
    const handlers = (send: () => Promise<void>) =>
      outboxHandlers({
        db: appDb.db,
        logger,
        mailer: { send },
        appUrl: "http://localhost:8080",
        linkSecret: "test-only-".padEnd(40, "x"),
      });
    const failing = handlers(async () => {
      throw new Error(`550 5.1.1 <${f.users.admin.email}>: Recipient rejected: ${MARKED}`);
    });
    const opts = { db: appDb.db, logger, batchSize: 1000, backoffSeconds: () => 0 };
    await relayOnce({ ...opts, handlers: failing });
    const { rows } = await owner.db.execute<{ last_error: string | null }>(
      sql`select last_error from platform.outbox where tenant_id = ${f.tenantId}`,
    );
    expect(rows.some((r) => r.last_error?.includes("550"))).toBe(true);
    expect(rows.map((r) => r.last_error).join("\n")).not.toMatch(
      new RegExp(`${NAME}|${PHONE}|${f.users.admin.email}`),
    );
    await relayOnce({ ...opts, handlers: handlers(async () => {}) });
    await relayOnce({ ...opts, handlers: cognito.handlers });
  });

  it("DB の失敗(値が文に入る)", async () => {
    await appDb.pool.query("select $1::int", [MARKED]).catch((err) => logger.error({ err }, "x"));
    await appDb.db
      .execute(sql`select ${MARKED}::int`)
      .catch((err: unknown) => logger.error({ err }, "x"));
  });

  it("出たログの全行に、目印が1つも無い", () => {
    const leaked = lines.filter((l) => [...markers].some((m) => l.includes(m)));
    expect(leaked.slice(0, 5), `${leaked.length} 行に目印が出ています`).toEqual([]);
  });
});

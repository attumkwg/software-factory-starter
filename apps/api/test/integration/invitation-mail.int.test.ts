import type { Invitation } from "@app/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../../src/db/client.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { invitationToken } from "../../src/domains/organizations/index.ts";
import { createLogger } from "../../src/logger.ts";
import type { MailMessage } from "../../src/mail/index.ts";
import { createTenant, parseTenantApplication } from "../../src/onboarding/create-tenant.ts";
import { type OutboxEvent, type OutboxTopic, outboxHandlers } from "../../src/outbox/index.ts";
import {
  call,
  createTenantFixture,
  createTestApp,
  login,
  type TenantFixture,
} from "../helpers/fixtures.ts";

// 招待のメールと、開通の案内のメール(docs/specs/0027-invitations.md)。受け手を直接呼ぶ
// (ほかのテストの送り出しと、同じ出来事を取り合わないように。mail.int.test.ts と同じ形)。

const SECRET = "test-only-".padEnd(40, "x");
const APP_URL = "https://app.example.test";
const owner = createDb(inject("ownerUrl"));
const appDb = createDb(inject("appUrl"));
let a: TenantFixture;
let app: ReturnType<typeof createTestApp>["app"];
let pool: ReturnType<typeof createTestApp>["pool"];
let aAdmin: string;
const sent: MailMessage[] = [];
const handlers = outboxHandlers({
  db: appDb.db,
  logger: createLogger({ level: "silent" }),
  mailer: { send: async (m) => void sent.push(m) },
  appUrl: APP_URL,
  linkSecret: SECRET,
});

beforeAll(async () => {
  a = await createTenantFixture(owner.db, "acme");
  ({ app, pool } = createTestApp(inject("appUrl")));
  aAdmin = await login(app, a.users.admin.email);
});
afterAll(async () => {
  await owner.pool.end();
  await appDb.pool.end();
  await pool.end();
});

let n = 0;
const newEmail = (label = "new") => {
  n += 1;
  return `${label}-${n}-${Date.now()}@invitee.test`;
};

async function invited(email: string): Promise<Invitation> {
  const res = await call(app, "POST", "/api/invitations", {
    cookie: aAdmin,
    body: { email, role: "member" },
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Invitation;
}

async function outboxOf(tenantId: string, topic: OutboxTopic): Promise<OutboxEvent[]> {
  const r = await withTenant(owner.db, tenantId, (tx) =>
    tx.execute<{ id: string; payload: unknown; attempts: number; created_at: Date }>(
      sql`select id, payload, attempts, created_at from platform.outbox
        where tenant_id = ${tenantId} and topic = ${topic} order by id`,
    ),
  );
  return r.rows.map((e) => ({
    id: e.id,
    tenantId,
    topic,
    payload: e.payload,
    attempts: e.attempts,
    createdAt: e.created_at,
  }));
}

async function eventFor(invitationId: string): Promise<OutboxEvent> {
  const event = (await outboxOf(a.tenantId, "organizations.invitation_created")).find(
    (e) => (e.payload as { invitationId: string }).invitationId === invitationId,
  );
  if (!event) throw new Error("出来事が無い");
  return event;
}

describe("招待のメール", () => {
  it("招いたアドレスへ。リンクは # の後ろに札があり、そのまま受けられる", async () => {
    const email = newEmail();
    const inv = await invited(email);
    sent.length = 0;
    await handlers["organizations.invitation_created"]?.(await eventFor(inv.id));
    expect(sent).toHaveLength(1);
    const mail = sent[0] as MailMessage;
    expect(mail.to).toBe(email);
    expect(mail.text).toContain("メンバー");
    const link = mail.text.match(/https:\/\/app\.example\.test\/invitation#(\S+)/);
    expect(link?.[1]).toBe(invitationToken(SECRET, inv.id));
    const res = await call(app, "POST", "/api/invitations/accept", {
      body: { token: link?.[1], name: "新しい 人" },
    });
    expect(res.status).toBe(200);
  });

  it("同じ出来事は同じ Message-ID(2回届いても、受け手が重なりに気づける)", async () => {
    const inv = await invited(newEmail());
    const event = await eventFor(inv.id);
    sent.length = 0;
    await handlers["organizations.invitation_created"]?.(event);
    await handlers["organizations.invitation_created"]?.(event);
    expect(sent[0]?.messageId).toBe(sent[1]?.messageId);
  });

  it("取り消した招待のメールは送らない(出来事が遅れて届いても)", async () => {
    const inv = await invited(newEmail());
    await call(app, "DELETE", `/api/invitations/${inv.id}`, { cookie: aAdmin });
    sent.length = 0;
    await handlers["organizations.invitation_created"]?.(await eventFor(inv.id));
    expect(sent).toEqual([]);
  });
});

describe("開通の案内のメール", () => {
  it("運営のコマンドが組織を作ると、最初の管理者に登録の URL が届く", async () => {
    const { application } = parseTenantApplication(
      JSON.stringify({
        name: `開通 ${Date.now()}`,
        admin: { email: newEmail("owner"), name: "工藤 一郎" },
      }),
    );
    const done = await createTenant(owner.db, application, {
      execute: true,
      confirmName: application.name,
      supportTenantId: null,
    });
    const [event] = await outboxOf(done.tenantId, "organizations.tenant_opened");
    expect(event?.payload).toEqual({ userId: done.adminUserId });
    sent.length = 0;
    await handlers["organizations.tenant_opened"]?.(event as OutboxEvent);
    expect(sent[0]?.to).toBe(application.admin.email);
    expect(sent[0]?.text).toContain(`${APP_URL}/sign-up`);
  });
});

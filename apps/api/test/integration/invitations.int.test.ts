import type { AcceptedInvitation, Invitation, InvitationPage, Me } from "@app/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../../src/db/client.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { invitationToken } from "../../src/domains/organizations/index.ts";
import type { OutboxEvent, OutboxTopic } from "../../src/outbox/index.ts";
import {
  call,
  createTenantFixture,
  createTestApp,
  login,
  type TenantFixture,
} from "../helpers/fixtures.ts";

// 招待(docs/specs/0027-invitations.md)の受け入れ条件。必ず2社(a・b)で。
// リンクの札は、テストのアプリと同じ秘密(SESSION_SECRET)で作る。

const SECRET = "test-only-".padEnd(40, "x");
const owner = createDb(inject("ownerUrl"));
const appDb = createDb(inject("appUrl"));
let a: TenantFixture;
let b: TenantFixture;
let app: ReturnType<typeof createTestApp>["app"];
let pool: ReturnType<typeof createTestApp>["pool"];
let aAdmin: string;
let bAdmin: string;

beforeAll(async () => {
  a = await createTenantFixture(owner.db, "acme");
  b = await createTenantFixture(owner.db, "globex");
  ({ app, pool } = createTestApp(inject("appUrl")));
  aAdmin = await login(app, a.users.admin.email);
  bAdmin = await login(app, b.users.admin.email);
});
afterAll(async () => {
  await owner.pool.end();
  await appDb.pool.end();
  await pool.end();
});

let n = 0;
const newEmail = (label = "new") => {
  n += 1;
  return `${label}-${n}-${Date.now()}@Invitee.test`;
};

async function invite(cookie: string, email: string, role = "member") {
  return call(app, "POST", "/api/invitations", { cookie, body: { email, role } });
}

async function invited(cookie: string, email: string, role = "member"): Promise<Invitation> {
  const res = await invite(cookie, email, role);
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as Invitation;
}

const accept = (token: string, name = "新しい 人", cookie?: string) =>
  call(app, "POST", "/api/invitations/accept", {
    body: { token, name },
    ...(cookie ? { cookie } : {}),
  });

async function invitationRow(tenantId: string, id: string) {
  const r = await withTenant(owner.db, tenantId, (tx) =>
    tx.execute<{ accepted_at: Date | null; accepted_user_id: string | null }>(
      sql`select accepted_at, accepted_user_id from organizations.invitations where id = ${id}`,
    ),
  );
  return r.rows[0];
}

async function userByEmail(tenantId: string, email: string) {
  const r = await withTenant(owner.db, tenantId, (tx) =>
    tx.execute<{ id: string; name: string; role: string; external_id: string | null }>(
      sql`select id, name, role, external_id from organizations.users
        where tenant_id = ${tenantId} and email = ${email}`,
    ),
  );
  return r.rows[0];
}

async function auditOf(tenantId: string, targetId: string) {
  const r = await withTenant(owner.db, tenantId, (tx) =>
    tx.execute<{ action: string; actor_kind: string; actor_id: string; details: object }>(
      sql`select action, actor_kind, actor_id, details from platform.audit_events
        where tenant_id = ${tenantId} and target_id = ${targetId} order by id`,
    ),
  );
  return r.rows;
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

describe("管理者が人を招く", () => {
  it("招くと、生きている招待ができ(メールは小文字)、出来事(ID だけ)と監査ログが同じトランザクションで残る", async () => {
    const email = newEmail();
    const inv = await invited(aAdmin, email, "viewer");
    expect(inv).toMatchObject({ email: email.toLowerCase(), role: "viewer", status: "pending" });
    const days = (Date.parse(inv.expiresAt) - Date.parse(inv.createdAt)) / 86_400_000;
    expect(days).toBeCloseTo(7, 1);
    const events = await outboxOf(a.tenantId, "organizations.invitation_created");
    expect(events.map((e) => e.payload)).toContainEqual({ invitationId: inv.id });
    expect(await auditOf(a.tenantId, inv.id)).toEqual([
      {
        action: "invitation.create",
        actor_kind: "user",
        actor_id: a.users.admin.id,
        details: {},
      },
    ]);
  });

  it("もうこの組織にいる人・生きている招待がある人は 409(取り消せば招き直せる)", async () => {
    expect((await invite(aAdmin, a.users.member.email)).status).toBe(409);
    const email = newEmail();
    const first = await invited(aAdmin, email);
    const again = await invite(aAdmin, email.toUpperCase());
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe(
      "already_invited",
    );
    expect(
      (await call(app, "DELETE", `/api/invitations/${first.id}`, { cookie: aAdmin })).status,
    ).toBe(204);
    expect((await invite(aAdmin, email)).status).toBe(201);
  });

  it("ほかの組織にいる人も、招くことはできる(他社の利用者の有無を管理者に教えない。受けるときに止まる)", async () => {
    expect((await invite(aAdmin, b.users.viewer.email)).status).toBe(201);
  });

  it("一覧は自社の招待だけ(他社の招待は出ない)。他社の招待は取り消せない(404)", async () => {
    const mine = await invited(bAdmin, newEmail("b"));
    const page = (await (
      await call(app, "GET", "/api/invitations?limit=100", { cookie: aAdmin })
    ).json()) as InvitationPage;
    expect(page.invitations.map((i) => i.id)).not.toContain(mine.id);
    expect(page.invitations.map((i) => i.id)).toContain(a.invitationId);
    const res = await call(app, "DELETE", `/api/invitations/${mine.id}`, { cookie: aAdmin });
    expect(res.status).toBe(404);
  });

  it("受けた・取り消した招待は、取り消せない(409)", async () => {
    const inv = await invited(aAdmin, newEmail());
    await call(app, "DELETE", `/api/invitations/${inv.id}`, { cookie: aAdmin });
    const res = await call(app, "DELETE", `/api/invitations/${inv.id}`, { cookie: aAdmin });
    expect(res.status).toBe(409);
  });
});

describe("招かれた人が受ける(ログイン無し)", () => {
  it("受けると、札が指す組織に、招いたロールで入る。受けた記録は、その組織の監査ログに本人として残る", async () => {
    const email = newEmail();
    const inv = await invited(aAdmin, email, "viewer");
    const res = await accept(invitationToken(SECRET, inv.id), "  佐藤 花子  ");
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as AcceptedInvitation;
    expect(body.email).toBe(email.toLowerCase());
    const user = await userByEmail(a.tenantId, email.toLowerCase());
    expect(user).toMatchObject({ name: "佐藤 花子", role: "viewer", external_id: null });
    expect(await invitationRow(a.tenantId, inv.id)).toMatchObject({
      accepted_user_id: user?.id,
    });
    const audit = await auditOf(a.tenantId, inv.id);
    expect(audit.at(-1)).toMatchObject({ action: "invitation.accept", actor_id: user?.id });
    // 一覧では「受けた」
    const page = (await (
      await call(app, "GET", "/api/invitations?limit=100", { cookie: aAdmin })
    ).json()) as InvitationPage;
    expect(page.invitations.find((i) => i.id === inv.id)?.status).toBe("accepted");
  });

  it("受けた人は、そのメールでログインすると、その組織に入る(ほかの組織の物は見えない)", async () => {
    const email = newEmail();
    const inv = await invited(aAdmin, email);
    expect((await accept(invitationToken(SECRET, inv.id))).status).toBe(200);
    const cookie = await login(app, email.toLowerCase());
    const me = (await (await call(app, "GET", "/api/me", { cookie })).json()) as Me;
    expect(me).toMatchObject({ tenantId: a.tenantId, role: "member" });
    const consents = me.legal?.pending ?? [];
    await call(app, "POST", "/api/legal/consents", { cookie, body: { consents } });
    const other = await call(app, "GET", `/api/projects/${b.projectId}`, { cookie });
    expect(other.status).toBe(404);
  });
});

describe("受けられない場合", () => {
  it("リンクは1回きり(2回目は 400)", async () => {
    const inv = await invited(aAdmin, newEmail());
    const token = invitationToken(SECRET, inv.id);
    expect((await accept(token)).status).toBe(200);
    const again = await accept(token, "別の人");
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe(
      "invalid_invitation",
    );
  });

  it("取り消した・期限が過ぎた招待は受けられない(同じ 400。どれかは言わない)", async () => {
    const revoked = await invited(aAdmin, newEmail());
    await call(app, "DELETE", `/api/invitations/${revoked.id}`, { cookie: aAdmin });
    expect((await accept(invitationToken(SECRET, revoked.id))).status).toBe(400);

    const expired = await invited(aAdmin, newEmail());
    await withTenant(owner.db, a.tenantId, (tx) =>
      tx.execute(
        sql`update organizations.invitations set expires_at = now() - interval '1 second' where id = ${expired.id}`,
      ),
    );
    expect((await accept(invitationToken(SECRET, expired.id))).status).toBe(400);
    expect(await invitationRow(a.tenantId, expired.id)).toMatchObject({ accepted_at: null });
  });

  it("署名が違う・ほかの秘密で作った・形が違う札は 400(DB に聞く前に止まる)", async () => {
    const inv = await invited(aAdmin, newEmail());
    const good = invitationToken(SECRET, inv.id);
    for (const token of [
      `${inv.id}.${"A".repeat(43)}`,
      invitationToken("another-secret-".padEnd(40, "y"), inv.id),
      inv.id,
      `${good}.extra`,
    ]) {
      expect((await accept(token)).status).toBe(400);
    }
    expect(await invitationRow(a.tenantId, inv.id)).toMatchObject({ accepted_at: null });
  });

  it("他社の札に、別の組織の札の署名は付け替えられない(ID ごとの署名)", async () => {
    const mine = await invited(aAdmin, newEmail());
    const theirs = await invited(bAdmin, newEmail("b"));
    const [, theirMac] = invitationToken(SECRET, theirs.id).split(".");
    expect((await accept(`${mine.id}.${theirMac}`)).status).toBe(400);
  });

  it("組織はセッションではなく札で決まる(他社の管理者がログインしたまま受けても、札の組織に入る)", async () => {
    const email = newEmail();
    const inv = await invited(aAdmin, email);
    expect((await accept(invitationToken(SECRET, inv.id), "誰か", bAdmin)).status).toBe(200);
    expect(await userByEmail(a.tenantId, email.toLowerCase())).toBeDefined();
    expect(await userByEmail(b.tenantId, email.toLowerCase())).toBeUndefined();
  });

  it("ほかの組織にもういる人も受けられ、所属が増える(b の所属はそのまま。ADR 0066)", async () => {
    const inv = await invited(aAdmin, b.users.member.email, "viewer");
    const res = await accept(invitationToken(SECRET, inv.id), "a での名前");
    expect(res.status).toBe(200);
    expect(await userByEmail(a.tenantId, b.users.member.email)).toMatchObject({
      name: "a での名前",
      role: "viewer",
    });
    expect(await userByEmail(b.tenantId, b.users.member.email)).toMatchObject({ role: "member" });
    // ログインは前回の組織(まだ a に入っていないので b のまま)。a へは選び直す
    const cookie = await login(app, b.users.member.email);
    const me = (await (await call(app, "GET", "/api/me", { cookie })).json()) as Me;
    expect(me).toMatchObject({ tenantId: b.tenantId, organizationsCount: 2 });
  });

  it("アプリの接続は users に行を足せない(人が増えるのは、生きている招待を受ける関数だけ)", async () => {
    await expect(
      withTenant(appDb.db, a.tenantId, (tx) =>
        tx.execute(
          sql`insert into organizations.users (id, tenant_id, email, name, role)
            values (gen_random_uuid(), ${a.tenantId}, 'sneaky@acme.test', 'x', 'admin')`,
        ),
      ),
    ).rejects.toThrow();
  });
});

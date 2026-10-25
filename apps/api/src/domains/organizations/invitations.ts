import { createHmac, timingSafeEqual } from "node:crypto";
import {
  type CreateInvitation,
  INVITATION_DAYS,
  type Invitation,
  type InvitationPage,
  type InvitationStatus,
  type PlanDefinition,
} from "@app/shared";
import { and, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { RootDb, TenantTx } from "../../db/client.ts";
import { beyondCursor, cursorTime, decodeCursor, toPage } from "../../db/paging.ts";
import type { TenantScope } from "../../db/scope.ts";
import { ApiError, notFound } from "../../errors.ts";
import type { MailMessage } from "../../mail/index.ts";
import { enqueue, type OutboxEvent, type OutboxPayload } from "../../outbox/index.ts";
import { ensureSeatAvailable } from "../../plans/index.ts";
import type { NoMail } from "./notifications.ts";
import { findContact } from "./repository.ts";
import { invitations, tenants, users } from "./schema.ts";

// 招待(docs/specs/0027-invitations.md・ADR 0040)。管理者が人を招き、招かれた人がリンクから受ける。
//
// リンクの札は DB に持たない。札 = 招待の ID + サーバーの秘密(SESSION_SECRET から用途を分けて作った鍵)での署名。
// 送る直前(アウトボックスの受け手)に作り、受けるときに確かめる。期限・1回きり・取り消しは招待の行で決まる。
// 秘密を入れ替えると、まだ受けていない招待のリンクは全部使えなくなる(招き直す)。

/** 生きている招待の上限(1つの組織で)。招待のメールを大量に送らせない */
export const MAX_PENDING_INVITATIONS = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

// ── リンクの札 ───────────────────────────────────────────────────────────────

/** 秘密から、招待のリンクだけに使う鍵を作る(Cookie の署名と同じ鍵をそのまま使わない) */
const linkKey = (secret: string) =>
  createHmac("sha256", secret).update("invitation-link/v1").digest();

const sign = (secret: string, invitationId: string) =>
  createHmac("sha256", linkKey(secret)).update(invitationId).digest("base64url");

/** リンクの札(`<招待の ID>.<署名>`)。URL の # の後ろに置く(サーバーのログ・Referer に残さない) */
export function invitationToken(secret: string, invitationId: string): string {
  return `${invitationId}.${sign(secret, invitationId)}`;
}

/** 札を確かめて、招待の ID を返す。形が違う・署名が違えば null(DB には聞かない) */
export function verifyInvitationToken(secret: string, token: string): string | null {
  const [id, mac, ...rest] = token.split(".");
  if (!id || !mac || rest.length > 0) return null;
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) return null;
  const expected = Buffer.from(sign(secret, id));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return id;
}

// ── 管理者(認可の関所の中。c.var.tx) ──────────────────────────────────────

type Row = Pick<
  typeof invitations.$inferSelect,
  "id" | "email" | "role" | "createdAt" | "expiresAt" | "acceptedAt" | "revokedAt"
>;

function statusOf(r: Row, now: Date): InvitationStatus {
  if (r.acceptedAt) return "accepted";
  if (r.revokedAt) return "revoked";
  return r.expiresAt > now ? "pending" : "expired";
}

const toInvitation = (r: Row, now: Date): Invitation => ({
  id: r.id,
  email: r.email,
  role: r.role,
  status: statusOf(r, now),
  createdAt: r.createdAt.toISOString(),
  expiresAt: r.expiresAt.toISOString(),
});

const columns = {
  id: invitations.id,
  email: invitations.email,
  role: invitations.role,
  createdAt: invitations.createdAt,
  expiresAt: invitations.expiresAt,
  acceptedAt: invitations.acceptedAt,
  revokedAt: invitations.revokedAt,
};

/** 生きている(受けていない・取り消していない・期限内)の条件 */
const pending = (now: Date) =>
  and(
    isNull(invitations.acceptedAt),
    isNull(invitations.revokedAt),
    gt(invitations.expiresAt, now),
  );

/** 新しい順。cursor は前のページの nextCursor(索引 invitations_list_idx) */
export async function listInvitations(
  s: TenantScope,
  opts: { cursor?: string | undefined; limit: number },
): Promise<InvitationPage> {
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
  const rows = await s.tx
    .select({ ...columns, cursorAt: cursorTime(invitations.createdAt) })
    .from(invitations)
    .where(
      and(
        eq(invitations.tenantId, s.tenantId),
        beyondCursor(cursor, "desc", invitations.createdAt, invitations.id),
      ),
    )
    .orderBy(desc(invitations.createdAt), desc(invitations.id))
    .limit(opts.limit + 1);
  const page = toPage(rows, opts.limit, (r) => ({ at: r.cursorAt, id: r.id }));
  const now = new Date();
  return { invitations: page.rows.map((r) => toInvitation(r, now)), nextCursor: page.nextCursor };
}

/**
 * 人を招く。招待のメールは同じトランザクションで出来事として積む(送るのは受け手)。
 * 止める(409): その人はもうこの組織にいる・生きている招待がもうある・生きている招待が上限・
 * プランの人数の上限に届いている(いる人+受けていない招待。docs/specs/0047-plans.md)。
 * **ほかの組織にいるかは確かめない**(管理者に他社の利用者の有無を教えない)。受けるときに止まる。
 */
export async function createInvitation(
  s: TenantScope,
  input: CreateInvitation,
  plans: readonly PlanDefinition[],
): Promise<Invitation> {
  const now = new Date();
  const [member] = await s.tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, s.tenantId), eq(users.email, input.email)));
  if (member) throw new ApiError(409, "already_member", "この人はもうこの組織にいます");
  const [dup] = await s.tx
    .select({ id: invitations.id })
    .from(invitations)
    .where(
      and(eq(invitations.tenantId, s.tenantId), eq(invitations.email, input.email), pending(now)),
    );
  if (dup) throw new ApiError(409, "already_invited", "まだ受けていない招待があります");
  const [live] = await s.tx
    .select({ n: count() })
    .from(invitations)
    .where(and(eq(invitations.tenantId, s.tenantId), pending(now)));
  if ((live?.n ?? 0) >= MAX_PENDING_INVITATIONS) {
    throw new ApiError(409, "too_many_invitations", "受けていない招待が多すぎます");
  }
  await ensureSeatAvailable(s.tx, s.tenantId, plans);
  const [row] = await s.tx
    .insert(invitations)
    .values({
      id: uuidv7(),
      tenantId: s.tenantId,
      email: input.email,
      role: input.role,
      invitedBy: s.userId,
      expiresAt: new Date(now.getTime() + INVITATION_DAYS * DAY_MS),
    })
    .returning(columns);
  if (!row) throw new Error("invitation not inserted");
  await enqueue(s, "organizations.invitation_created", { invitationId: row.id });
  return toInvitation(row, now);
}

/** 取り消す(受けていない物だけ。期限切れも取り消せる)。無い・他社の物は 404、受けた・取り消し済みは 409 */
export async function revokeInvitation(s: TenantScope, invitationId: string): Promise<void> {
  const [row] = await s.tx
    .select({ acceptedAt: invitations.acceptedAt, revokedAt: invitations.revokedAt })
    .from(invitations)
    .where(and(eq(invitations.tenantId, s.tenantId), eq(invitations.id, invitationId)));
  if (!row) throw notFound();
  if (row.acceptedAt || row.revokedAt) {
    throw new ApiError(409, "invitation_not_pending", "この招待はもう受けたか取り消してあります");
  }
  await s.tx
    .update(invitations)
    .set({ revokedAt: new Date(), revokedBy: s.userId })
    .where(
      and(
        eq(invitations.tenantId, s.tenantId),
        eq(invitations.id, invitationId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    );
}

// ── 招かれた人(ログイン無し。リンクの札で) ───────────────────────────────────

export type AcceptedInvitation = {
  tenantId: string;
  userId: string;
  tenantName: string;
  email: string;
  /** 監査ログの対象 */
  invitationId: string;
};

/**
 * 招待を受ける: 生きている招待を1回だけ使い、その組織に人(users の行)を足す。
 * 組織は**札が指す招待**から決まる(リクエストの値からは決めない)。行を足すのは DB の関数だけ(移行 0014)。
 * 生きていなければ null。メールがもうどこかの組織で使われていれば invitation_email_in_use(何も変わらない)。
 * after … 同じトランザクションで、組織の文脈を付けた後にすること(監査ログ)
 */
export async function acceptInvitation(
  db: RootDb,
  invitationId: string,
  name: string,
  after: (tx: TenantTx, accepted: AcceptedInvitation) => Promise<void>,
): Promise<AcceptedInvitation | null> {
  try {
    return await db.transaction(async (tx) => {
      const r = await tx.execute<{ tenant_id: string; user_id: string }>(
        sql`select tenant_id, user_id from auth_accept_invitation(${invitationId}, ${uuidv7()}, ${name})`,
      );
      const row = r.rows[0];
      if (!row) return null;
      // ここから先は、その組織の文脈で(RLS)
      await tx.execute(sql`select set_config('app.tenant_id', ${row.tenant_id}, true)`);
      const [who] = await tx
        .select({ tenantName: tenants.name, email: users.email })
        .from(users)
        .innerJoin(tenants, eq(tenants.tenantId, users.tenantId))
        .where(and(eq(users.tenantId, row.tenant_id), eq(users.id, row.user_id)));
      if (!who) throw new Error("accepted user not found");
      const accepted = { tenantId: row.tenant_id, userId: row.user_id, invitationId, ...who };
      await after(tx, accepted);
      return accepted;
    });
  } catch (e) {
    const cause = ((e as { cause?: unknown }).cause ?? e) as { code?: string; constraint?: string };
    if (cause.code === "23505" && cause.constraint === "users_email_key") {
      throw new ApiError(
        409,
        "invitation_email_in_use",
        "このメールアドレスは、ほかの組織で使われています",
      );
    }
    throw e;
  }
}

// ── メール(アウトボックスの受け手が、送る直前に組み立てる) ─────────────────────

const formatAt = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat("ja-JP", { timeZone, dateStyle: "long", timeStyle: "short" }).format(at);

const ROLE_LABELS = { admin: "管理者", member: "メンバー", viewer: "閲覧者" } as const;

const messageId = (kind: string, event: OutboxEvent, appUrl: string) =>
  `<${kind}.${event.id}@${new URL(appUrl).hostname}>`;

/** 招待のメール。宛先は招待のメールアドレス。生きていなければ送らない */
export async function invitationMail(
  tx: TenantTx,
  event: OutboxEvent,
  payload: OutboxPayload<"organizations.invitation_created">,
  opts: { appUrl: string; linkSecret: string },
): Promise<MailMessage | NoMail> {
  const [row] = await tx
    .select({
      ...columns,
      invitedBy: invitations.invitedBy,
      tenantName: tenants.name,
      timeZone: tenants.timeZone,
    })
    .from(invitations)
    .innerJoin(tenants, eq(tenants.tenantId, invitations.tenantId))
    .where(and(eq(invitations.tenantId, event.tenantId), eq(invitations.id, payload.invitationId)));
  if (!row) return { skip: "invitation_deleted" };
  const status = statusOf(row, new Date());
  if (status !== "pending") return { skip: `invitation_${status}` };
  const inviter = await findContact(tx, event.tenantId, row.invitedBy);
  const link = `${opts.appUrl}/invitation#${invitationToken(opts.linkSecret, row.id)}`;
  return {
    to: row.email,
    subject: `${row.tenantName} への招待`,
    text: [
      `${inviter?.name ?? "管理者"} さんから、${row.tenantName} に${ROLE_LABELS[row.role]}として招待されました。`,
      "",
      "次のリンクを開いて、名前を入れて参加してください。そのあと、このメールを受け取ったアドレスで登録(またはログイン)すると入れます。",
      "",
      link,
      "",
      `このリンクは ${formatAt(row.expiresAt, row.timeZone)} まで、1回だけ使えます。`,
      "心当たりが無い場合は、このメールを無視してください(参加しなければ何も起きません)。",
    ].join("\n"),
    messageId: messageId("invitation", event, opts.appUrl),
  };
}

/** 運営のコマンドが組織を作ったときの、最初の管理者への案内。宛先は users の行 */
export async function tenantOpenedMail(
  tx: TenantTx,
  event: OutboxEvent,
  payload: OutboxPayload<"organizations.tenant_opened">,
  appUrl: string,
): Promise<MailMessage | NoMail> {
  const user = await findContact(tx, event.tenantId, payload.userId);
  if (!user) return { skip: "user_deleted" };
  const [tenant] = await tx
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.tenantId, event.tenantId));
  if (!tenant) return { skip: "tenant_deleted" };
  return {
    to: user.email,
    subject: `${tenant.name} のご利用の準備ができました`,
    text: [
      `${user.name} さん`,
      "",
      `${tenant.name} のご利用の準備ができました。あなたが最初の管理者です。次の手順でお入りください。`,
      "",
      `1. ${appUrl}/sign-up を開き、このメールを受け取ったアドレスとパスワードで登録してください`,
      "2. 届いた確認コードを入れてください",
      "3. ログインすると、利用規約への同意の画面が出ます(組織として同意いただきます)",
      "4. 「設定」→「招待」から、ほかの方を招けます",
      "",
      "心当たりが無い場合は、このメールにそのまま返信してお知らせください。",
    ].join("\n"),
    messageId: messageId("tenant-opened", event, appUrl),
  };
}

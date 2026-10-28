import type { OrganizationMember, OrganizationMemberPage, Role } from "@app/shared";
import { and, asc, eq, isNull, type SQL, sql } from "drizzle-orm";
import { beyondCursor, cursorTime, decodeCursor, toPage } from "../../db/paging.ts";
import type { TenantScope } from "../../db/scope.ts";
import { ApiError, forbidden, notFound } from "../../errors.ts";
import { ssoConnections, users } from "./schema.ts";
import { inVerifiedDomain } from "./scim.ts";

// 組織の人(管理者。docs/specs/0079-member-admin.md・docs/designs/0079-member-admin.md):
// 一覧・強制ログアウト・止める・戻す・ロールを変える。
//   外す = 止める(行・作った物・監査ログは残す。ログインできず、契約の人数にも数えない。戻せる。設計書 0079 の U-1)。
//   1人分のデータを本当に消すのは運営の person-data(G-06)。
//   情シスの道具(SCIM)が扱う人も画面で変えられる。道具が次に「有効」を送れば戻る(U-2)。

/** 情シスの道具が扱える人か(生きている SCIM の鍵があり、確かめたドメインのメールの人。scim.ts と同じ範囲) */
const scimManaged: SQL<boolean> = sql<boolean>`(${inVerifiedDomain} and exists (
  select 1 from organizations.scim_tokens k where k.tenant_id = ${users.tenantId} and k.revoked_at is null))`;

const memberColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  createdAt: users.createdAt,
  disabledAt: users.disabledAt,
  scimManaged,
};
type MemberRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: Date;
  disabledAt: Date | null;
  scimManaged: boolean;
};
const toMember = (u: MemberRow): OrganizationMember => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  createdAt: u.createdAt.toISOString(),
  disabledAt: u.disabledAt?.toISOString() ?? null,
  scimManaged: u.scimManaged,
});

/** 組織の人(古い順に1ページずつ)。止めた人も出す(戻せるように) */
export async function listMembers(
  s: TenantScope,
  opts: { cursor?: string | undefined; limit: number },
): Promise<OrganizationMemberPage> {
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
  const rows = await s.tx
    .select({ ...memberColumns, cursorAt: cursorTime(users.createdAt) })
    .from(users)
    .where(
      and(eq(users.tenantId, s.tenantId), beyondCursor(cursor, "asc", users.createdAt, users.id)),
    )
    .orderBy(asc(users.createdAt), asc(users.id))
    .limit(opts.limit + 1);
  const page = toPage(rows, opts.limit, (r) => ({ at: r.cursorAt, id: r.id }));
  return { members: page.rows.map(toMember), nextCursor: page.nextCursor };
}

async function findMember(s: TenantScope, userId: string): Promise<OrganizationMember | null> {
  const [row] = await s.tx
    .select(memberColumns)
    .from(users)
    .where(and(eq(users.tenantId, s.tenantId), eq(users.id, userId)));
  return row ? toMember(row) : null;
}

/**
 * その人の、この組織のセッションを全部切る(次のリクエストから 401)。サーバー側のセッション保存は作らず、
 * 関所が毎回見ている sessions_valid_after を今にする(ADR 0067・0017)。いなければ false
 */
export async function signOutMember(s: TenantScope, userId: string): Promise<boolean> {
  const rows = await s.tx
    .update(users)
    .set({ sessionsValidAfter: new Date() })
    .where(and(eq(users.tenantId, s.tenantId), eq(users.id, userId)))
    .returning({ id: users.id });
  return rows.length > 0;
}

// ── 止める・戻す・ロールを変える ─────────────────────────────────────────────

type Target = { id: string; role: Role; disabledAt: Date | null; ssoExempt: boolean };

/**
 * 変える前の確かめ。自分は変えられない(409)。いなければ 404。
 * 有効な管理者の行を ID の順に全部ロックしてから、操作する管理者がまだ有効な管理者かを見直す。
 * 2人の管理者が同時にお互いを外しても、後の方は 403 になり、有効な管理者が0人にならない
 * (操作する人は対象と別の有効な管理者なので、変えた後も1人は残る)。
 */
async function lockTarget(s: TenantScope, memberId: string): Promise<Target> {
  if (memberId === s.userId) {
    throw new ApiError(
      409,
      "cannot_change_yourself",
      "自分のロール・有効かは、自分では変えられません。ほかの管理者に頼んでください",
    );
  }
  const admins = await s.tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, s.tenantId), eq(users.role, "admin"), isNull(users.disabledAt)))
    .orderBy(asc(users.id))
    .for("update");
  if (!admins.some((a) => a.id === s.userId)) throw forbidden();
  const [target] = await s.tx
    .select({
      id: users.id,
      role: users.role,
      disabledAt: users.disabledAt,
      ssoExempt: users.ssoExempt,
    })
    .from(users)
    .where(and(eq(users.tenantId, s.tenantId), eq(users.id, memberId)))
    .for("update");
  if (!target) throw notFound();
  return target;
}

/**
 * 緊急用の管理者(SSO が止まったときにパスワードで入れる人)を外すとき。外した後に緊急用が残らず、
 * SSO を必須にしているなら 409(IdP が止まると誰も入れなくなる。設計書 0056 の U-3)
 */
async function releaseSsoExempt(s: TenantScope, target: Target): Promise<void> {
  if (!target.ssoExempt) return;
  const [conn] = await s.tx
    .select({ required: ssoConnections.required })
    .from(ssoConnections)
    .where(eq(ssoConnections.tenantId, s.tenantId));
  if (conn?.required) {
    const [other] = await s.tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.tenantId, s.tenantId),
          eq(users.ssoExempt, true),
          eq(users.role, "admin"),
          isNull(users.disabledAt),
          sql`${users.id} <> ${target.id}`,
        ),
      )
      .limit(1);
    if (!other) {
      throw new ApiError(
        409,
        "last_sso_exempt",
        "SSO を必須にしている間は、緊急用の管理者を0人にできません。先に「SSO」の設定で別の緊急用を選んでください",
      );
    }
  }
  await s.tx
    .update(users)
    .set({ ssoExempt: false })
    .where(and(eq(users.tenantId, s.tenantId), eq(users.id, target.id)));
}

/** ロールを変える。管理者から外すと、緊急用からも外れる。同じロールなら何もしない */
export async function changeMemberRole(
  s: TenantScope,
  memberId: string,
  role: Role,
): Promise<OrganizationMember> {
  const target = await lockTarget(s, memberId);
  if (target.role !== role) {
    if (role !== "admin") await releaseSsoExempt(s, target);
    await s.tx
      .update(users)
      .set({ role })
      .where(and(eq(users.tenantId, s.tenantId), eq(users.id, memberId)));
  }
  return (await findMember(s, memberId)) as OrganizationMember;
}

/**
 * 止める(外す)。その人のこの組織のセッションも切る(強制ログアウトと同じ)。ほかの組織の所属には触れない。
 * もう止めていれば何もしない
 */
export async function disableMember(s: TenantScope, memberId: string): Promise<OrganizationMember> {
  const target = await lockTarget(s, memberId);
  if (!target.disabledAt) {
    await releaseSsoExempt(s, target);
    const now = new Date();
    await s.tx
      .update(users)
      .set({ disabledAt: now, sessionsValidAfter: now })
      .where(and(eq(users.tenantId, s.tenantId), eq(users.id, memberId)));
  }
  return (await findMember(s, memberId)) as OrganizationMember;
}

/**
 * 戻す。前のロールのまま入れるようになる(緊急用には戻らない)。人数の上限は見ない(超えても止めない。仕様 0047)。
 * 止めていなければ何もしない
 */
export async function enableMember(s: TenantScope, memberId: string): Promise<OrganizationMember> {
  const target = await lockTarget(s, memberId);
  if (target.disabledAt) {
    await s.tx
      .update(users)
      .set({ disabledAt: null })
      .where(and(eq(users.tenantId, s.tenantId), eq(users.id, memberId)));
  }
  return (await findMember(s, memberId)) as OrganizationMember;
}

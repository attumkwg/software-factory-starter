import type { Role } from "@app/shared";
import { and, count, desc, eq, getTableColumns, gt, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../../db/client.ts";
import { beyondCursor, cursorTime, decodeCursor, toPage } from "../../db/paging.ts";
import type { TenantScope } from "../../db/scope.ts";
import { syncPerson } from "./memberships.ts";
import { emailChanges, tenants, users } from "./schema.ts";

// アカウントの安全(docs/specs/0006-account-security.md)の読み書き。Cognito は呼ばない(auth/account-routes.ts が呼ぶ)。

/** メールの変更の申し込みが生きている長さ(Cognito の確認コードの期限と同じ24時間) */
const EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000;

/** 認可の関所が毎回引く「この人を通してよいか」の材料。いなければ null */
export type Access = {
  role: Role;
  mfaEnabled: boolean;
  /** これより前にログインしたセッションは使えない */
  sessionsValidAfter: Date | null;
  /** その組織は二段階認証を必須にしているか */
  mfaRequired: boolean;
};

export async function findAccess(
  tx: TenantTx,
  tenantId: string,
  userId: string,
): Promise<Access | null> {
  const [row] = await tx
    .select({
      role: users.role,
      mfaEnabled: users.mfaEnabled,
      sessionsValidAfter: users.sessionsValidAfter,
      mfaRequired: tenants.mfaRequired,
    })
    .from(users)
    .innerJoin(tenants, eq(tenants.tenantId, users.tenantId))
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
  return row ?? null;
}

/** 画面「アカウント」に出す本人の状態 */
export async function getAccount(s: TenantScope) {
  const access = await findAccess(s.tx, s.tenantId, s.userId);
  const [user] = await s.tx
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.id, s.userId), eq(users.tenantId, s.tenantId)));
  if (!access || !user) return null;
  const pending = await findPendingEmailChange(s);
  return {
    email: user.email,
    mfaEnabled: access.mfaEnabled,
    pendingEmail: pending?.newEmail ?? null,
    organizationRequiresMfa: access.mfaRequired,
  };
}

/** 二段階認証の写しを直す(Cognito でコードを聞かれたか・有効にした・外した) */
export async function setMfaEnabled(s: TenantScope, enabled: boolean) {
  await s.tx
    .update(users)
    .set({ mfaEnabled: enabled })
    .where(and(eq(users.id, s.userId), eq(users.tenantId, s.tenantId)));
  // 二段階認証は人に1つ(Cognito)。ほかの組織の所属の写しもそろえる(docs/specs/0055-multi-org-membership.md)
  await syncPerson(s, { mfaEnabled: enabled });
}

/** ほかの端末のログインを切る(at より前にログインしたセッションを使えなくする) */
export async function endOtherSessions(s: TenantScope, at: Date) {
  await s.tx
    .update(users)
    .set({ sessionsValidAfter: at })
    .where(and(eq(users.id, s.userId), eq(users.tenantId, s.tenantId)));
  // ほかの組織の所属のセッションも切る(パスワードなどは人に1つ)
  await syncPerson(s, { sessionsValidAfter: at });
}

/** メールの変更を申し込む(前の申し込みは使われなくなる。消さずに残す) */
export async function requestEmailChange(
  s: TenantScope,
  change: { previousEmail: string; newEmail: string },
): Promise<string> {
  const [row] = await s.tx
    .insert(emailChanges)
    .values({ tenantId: s.tenantId, userId: s.userId, ...change })
    .returning({ id: emailChanges.id });
  if (!row) throw new Error("email change not inserted");
  return row.id;
}

/** 生きている申し込み(本人の最新・未確認・24時間以内)。無ければ null */
export async function findPendingEmailChange(s: TenantScope) {
  const [latest] = await s.tx
    .select({
      id: emailChanges.id,
      newEmail: emailChanges.newEmail,
      previousEmail: emailChanges.previousEmail,
      confirmedAt: emailChanges.confirmedAt,
    })
    .from(emailChanges)
    .where(
      and(
        eq(emailChanges.tenantId, s.tenantId),
        eq(emailChanges.userId, s.userId),
        gt(emailChanges.requestedAt, new Date(Date.now() - EMAIL_CHANGE_TTL_MS)),
      ),
    )
    .orderBy(desc(emailChanges.requestedAt))
    .limit(1);
  return latest && latest.confirmedAt === null ? latest : null;
}

/** メールを替え終える。users のメールの一意の索引に当たったら false(確かめと確認の間に、誰かが同じアドレスで足された) */
export async function confirmEmailChange(
  s: TenantScope,
  change: { id: string; newEmail: string },
): Promise<boolean> {
  try {
    await s.tx.transaction(async (sp) => {
      await sp
        .update(users)
        .set({ email: change.newEmail })
        .where(and(eq(users.id, s.userId), eq(users.tenantId, s.tenantId)));
      await sp
        .update(emailChanges)
        .set({ confirmedAt: new Date() })
        .where(
          and(
            eq(emailChanges.id, change.id),
            eq(emailChanges.tenantId, s.tenantId),
            isNull(emailChanges.confirmedAt),
          ),
        );
      // メールは人に1つ(Cognito)。ほかの組織の所属の写しもそろえる
      await syncPerson({ ...s, tx: sp }, { email: change.newEmail });
    });
    return true;
  } catch (e) {
    if ((e as { cause?: { code?: string } }).cause?.code === "23505") return false;
    if ((e as { code?: string }).code === "23505") return false;
    throw e;
  }
}

/** そのアドレスを、自分以外の誰か(どの組織でも)が使っているか。真偽だけ(DB の関数。0009 の移行) */
export async function isEmailInUse(tx: TenantTx, email: string, userId: string): Promise<boolean> {
  const r = await tx.execute<{ in_use: boolean }>(
    sql`select auth_email_in_use(${email}, ${userId}) as in_use`,
  );
  return r.rows[0]?.in_use === true;
}

/** 書き出し(docs/specs/0018-export-stream.md)。メールの変更の申し込みを新しい順に1ページずつ */
export async function exportEmailChangesPage(s: TenantScope, after: string | null, limit: number) {
  const cursor = after ? decodeCursor(after) : null;
  const rows = await s.tx
    .select({ ...getTableColumns(emailChanges), cursorAt: cursorTime(emailChanges.requestedAt) })
    .from(emailChanges)
    .where(
      and(
        eq(emailChanges.tenantId, s.tenantId),
        beyondCursor(cursor, "desc", emailChanges.requestedAt, emailChanges.id),
      ),
    )
    .orderBy(desc(emailChanges.requestedAt), desc(emailChanges.id))
    .limit(limit + 1);
  const page = toPage(rows, limit, (r) => ({ at: r.cursorAt, id: r.id }));
  const mapped = page.rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    previousEmail: r.previousEmail,
    newEmail: r.newEmail,
    requestedAt: r.requestedAt.toISOString(),
    confirmedAt: r.confirmedAt?.toISOString() ?? null,
  }));
  return { rows: mapped, nextCursor: page.nextCursor };
}

/** 組織の必須の状態と、まだ設定していない人の数(名前は出さない) */
export async function getMfaRequirement(s: TenantScope) {
  const [tenant] = await s.tx
    .select({ required: tenants.mfaRequired })
    .from(tenants)
    .where(eq(tenants.tenantId, s.tenantId));
  const [without] = await s.tx
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.tenantId, s.tenantId), eq(users.mfaEnabled, false)));
  return { required: tenant?.required ?? false, usersWithoutMfa: without?.n ?? 0 };
}

/** その組織が二段階認証を必須にしているか(代理で入る前に、見る組織の文脈で読む) */
export async function findMfaRequired(tx: TenantTx, tenantId: string): Promise<boolean> {
  const [row] = await tx
    .select({ required: tenants.mfaRequired })
    .from(tenants)
    .where(eq(tenants.tenantId, tenantId));
  return row?.required ?? false;
}

export async function setMfaRequired(s: TenantScope, required: boolean) {
  await s.tx.update(tenants).set({ mfaRequired: required }).where(eq(tenants.tenantId, s.tenantId));
}

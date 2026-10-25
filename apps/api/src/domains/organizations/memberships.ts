import type { Role } from "@app/shared";
import { and, eq, sql } from "drizzle-orm";
import type { RootDb, TenantTx } from "../../db/client.ts";
import { users } from "./schema.ts";

// 1人が複数の組織に所属する形(docs/specs/0055-multi-org-membership.md・ADR 0066)。
// users の行が「その組織への所属」。同じ人は Cognito の sub(external_id)で、開発用ログインではメールで見分ける。
// 組織が決まる前に所属を引くのは、DB の関数(移行 0017)だけ。アプリは users を全社分は読めない。

/** 人を見分ける鍵。sub があれば sub、無ければ(開発用ログイン・まだ結びついていない)メール */
export type PersonKey = { externalId: string | null; email: string };

export type Membership = {
  userId: string;
  tenantId: string;
  tenantName: string;
  role: Role;
  lastUsedAt: Date | null;
  createdAt: Date;
};

type Row = {
  user_id: string;
  tenant_id: string;
  tenant_name: string;
  role: Role;
  last_used_at: Date | string | null;
  created_at: Date | string;
};

const toDate = (v: Date | string) => (v instanceof Date ? v : new Date(v));

/**
 * その人の所属の一覧(前回入った組織が先・次に古い所属。50 まで)。
 * 組織が決まる前(ログイン)にも、組織の文脈の中(切り替え)にも使う。
 */
export async function findMemberships(
  db: RootDb | TenantTx,
  key: PersonKey,
): Promise<Membership[]> {
  const r = await db.execute<Row>(
    sql`select user_id, tenant_id, tenant_name, role, last_used_at, created_at
          from auth_find_memberships(${key.externalId}, ${key.externalId ? null : key.email})`,
  );
  return r.rows.map((m) => ({
    userId: m.user_id,
    tenantId: m.tenant_id,
    tenantName: m.tenant_name,
    role: m.role,
    lastUsedAt: m.last_used_at === null ? null : toDate(m.last_used_at),
    createdAt: toDate(m.created_at),
  }));
}

/** セッションの人の鍵(いまの組織の行から)。いなければ null */
export async function findPersonKey(
  tx: TenantTx,
  tenantId: string,
  userId: string,
): Promise<PersonKey | null> {
  const [row] = await tx
    .select({ externalId: users.externalId, email: users.email })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)));
  return row ?? null;
}

/** その組織に入った(ログイン・切り替え)。次のログインで「前回の組織」になる */
export async function markMembershipUsed(
  tx: TenantTx,
  tenantId: string,
  userId: string,
): Promise<void> {
  await tx
    .update(users)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)));
}

/**
 * 人に1つの物(メール・二段階認証の写し・ほかの端末を切った時刻)を、同じ人の全部の所属にそろえる。
 * 渡さなかった項目は変えない。sub が無い人(開発用ログイン)は、所属が組織をまたいで結びつかないので何もしない。
 */
export async function syncPerson(
  s: { tx: TenantTx; tenantId: string; userId: string },
  change: { email?: string; mfaEnabled?: boolean; sessionsValidAfter?: Date },
): Promise<void> {
  const key = await findPersonKey(s.tx, s.tenantId, s.userId);
  if (!key?.externalId) return;
  await s.tx.execute(
    sql`select auth_sync_person(${key.externalId}, ${change.email ?? null},
          ${change.mfaEnabled ?? null}, ${change.sessionsValidAfter?.toISOString() ?? null}::timestamptz)`,
  );
}

/** その人(sub)の所属の数(運営のコマンドが、Cognito から消してよいかを決める。最後の所属のときだけ消す) */
export async function countMemberships(db: RootDb | TenantTx, externalId: string): Promise<number> {
  const r = await db.execute<{ n: number }>(sql`select auth_count_memberships(${externalId}) as n`);
  return r.rows[0]?.n ?? 0;
}

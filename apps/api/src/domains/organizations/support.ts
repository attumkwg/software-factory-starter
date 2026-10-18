import { createHash, randomBytes } from "node:crypto";
import type { Me, SupportGrant } from "@app/shared";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../../db/client.ts";
import type { TenantScope } from "../../db/scope.ts";
import { supportGrants, supportSessions, tenants } from "./schema.ts";

// サポートの代理ログイン(docs/specs/0004-support-access.md・ADR 0014)。

/** 1回の入室の長さの上限(許可の期限が先に来れば、そこまで) */
export const SUPPORT_SESSION_MAX_MS = 60 * 60 * 1000;

// サポート番号: 紛らわしい字(0/O・1/I/L・U)を除いた30文字 × 12桁 = 約59ビット。読み上げやすいよう4桁ずつ区切る
const CODE_CHARS = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateSupportCode(): string {
  let out = "";
  while (out.length < 12) {
    for (const b of randomBytes(16)) {
      // 30 の倍数(240)未満だけを使う(偏りを無くす)
      if (b < 240 && out.length < 12) out += CODE_CHARS[b % 30];
    }
  }
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

/** 入力の揺れ(小文字・区切り・空白)をそろえてからハッシュにする。番号そのものは保存しない */
export function hashSupportCode(code: string): string {
  const normalized = code.toUpperCase().replace(/[^0-9A-Z]/g, "");
  return createHash("sha256").update(normalized).digest("hex");
}

type GrantRow = typeof supportGrants.$inferSelect;
const toGrant = (r: GrantRow, now: Date): SupportGrant => ({
  id: r.id,
  createdAt: r.createdAt.toISOString(),
  expiresAt: r.expiresAt.toISOString(),
  revokedAt: r.revokedAt?.toISOString() ?? null,
  status: r.revokedAt ? "revoked" : r.expiresAt <= now ? "expired" : "active",
});

export async function createSupportGrant(
  s: TenantScope,
  hours: number,
): Promise<SupportGrant & { code: string }> {
  const code = generateSupportCode();
  const [row] = await s.tx
    .insert(supportGrants)
    .values({
      tenantId: s.tenantId,
      grantedBy: s.userId,
      codeHash: hashSupportCode(code),
      expiresAt: new Date(Date.now() + hours * 60 * 60 * 1000),
    })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return { ...toGrant(row, new Date()), code };
}

export async function listSupportGrants(s: TenantScope): Promise<SupportGrant[]> {
  const rows = await s.tx
    .select()
    .from(supportGrants)
    .where(eq(supportGrants.tenantId, s.tenantId))
    .orderBy(desc(supportGrants.createdAt))
    .limit(20);
  const now = new Date();
  return rows.map((r) => toGrant(r, now));
}

/** 取り消す。入っている社員の入室も終わらせる(次のリクエストから入れない)。無ければ false */
export async function revokeSupportGrant(s: TenantScope, grantId: string): Promise<boolean> {
  const now = new Date();
  const [row] = await s.tx
    .update(supportGrants)
    .set({ revokedAt: now, revokedBy: s.userId })
    .where(
      and(
        eq(supportGrants.tenantId, s.tenantId),
        eq(supportGrants.id, grantId),
        isNull(supportGrants.revokedAt),
      ),
    )
    .returning({ id: supportGrants.id });
  if (!row) {
    // 取り消し済みなら、何もせずに成功(何度押しても同じ)
    const [exists] = await s.tx
      .select({ id: supportGrants.id })
      .from(supportGrants)
      .where(and(eq(supportGrants.tenantId, s.tenantId), eq(supportGrants.id, grantId)));
    return Boolean(exists);
  }
  await s.tx
    .update(supportSessions)
    .set({ endedAt: now })
    .where(
      and(
        eq(supportSessions.tenantId, s.tenantId),
        eq(supportSessions.grantId, grantId),
        isNull(supportSessions.endedAt),
      ),
    );
  return true;
}

/**
 * 社員が番号から許可を探す。テナントが決まる前なので、DB の関数(移行 0007)を通す
 * (アプリは許可を全社分は読めない)。期限切れ・取り消し済み・違う番号は、どれも null。
 */
export async function findSupportGrantByCode(
  db: TenantTx,
  code: string,
): Promise<{ grantId: string; tenantId: string; expiresAt: Date } | null> {
  const r = await db.execute<{ grant_id: string; tenant_id: string; expires_at: string | Date }>(
    sql`select grant_id, tenant_id, expires_at from support_find_grant(${hashSupportCode(code)})`,
  );
  const row = r.rows[0];
  return row
    ? { grantId: row.grant_id, tenantId: row.tenant_id, expiresAt: new Date(row.expires_at) }
    : null;
}

/** 入室を記録する(見る組織の文脈で)。期限は「1時間」と「許可の期限」の早いほう */
export async function startSupportSession(
  tx: TenantTx,
  input: {
    tenantId: string;
    grantId: string;
    grantExpiresAt: Date;
    staff: { userId: string; name: string; email: string };
  },
): Promise<{ sessionId: string; expiresAt: Date; tenantName: string }> {
  const expiresAt = new Date(
    Math.min(Date.now() + SUPPORT_SESSION_MAX_MS, input.grantExpiresAt.getTime()),
  );
  const [row] = await tx
    .insert(supportSessions)
    .values({
      tenantId: input.tenantId,
      grantId: input.grantId,
      staffUserId: input.staff.userId,
      staffName: input.staff.name,
      staffEmail: input.staff.email,
      expiresAt,
    })
    .returning({ id: supportSessions.id });
  const [tenant] = await tx
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.tenantId, input.tenantId));
  if (!row || !tenant) throw new Error("support session insert failed");
  return { sessionId: row.id, expiresAt, tenantName: tenant.name };
}

export type ActiveSupportSession = { expiresAt: Date; staffName: string; staffEmail: string };

/**
 * 認可の関所が毎回確かめる: その入室が終わっていない・期限内・許可が取り消されていない・期限内。
 * どれかが外れれば null(入れない)。
 */
export async function findActiveSupportSession(
  tx: TenantTx,
  tenantId: string,
  sessionId: string,
  staffUserId: string,
): Promise<ActiveSupportSession | null> {
  const now = new Date();
  const [row] = await tx
    .select({
      expiresAt: supportSessions.expiresAt,
      staffName: supportSessions.staffName,
      staffEmail: supportSessions.staffEmail,
    })
    .from(supportSessions)
    .innerJoin(
      supportGrants,
      and(
        eq(supportGrants.tenantId, supportSessions.tenantId),
        eq(supportGrants.id, supportSessions.grantId),
      ),
    )
    .where(
      and(
        eq(supportSessions.tenantId, tenantId),
        eq(supportSessions.id, sessionId),
        eq(supportSessions.staffUserId, staffUserId),
        isNull(supportSessions.endedAt),
        gt(supportSessions.expiresAt, now),
        isNull(supportGrants.revokedAt),
        gt(supportGrants.expiresAt, now),
      ),
    );
  return row ?? null;
}

export async function endSupportSession(tx: TenantTx, tenantId: string, sessionId: string) {
  await tx
    .update(supportSessions)
    .set({ endedAt: new Date() })
    .where(
      and(
        eq(supportSessions.tenantId, tenantId),
        eq(supportSessions.id, sessionId),
        isNull(supportSessions.endedAt),
      ),
    );
}

/** 代理の最中の「自分」: 見ている組織・閲覧者・社員の名前とメール・入室の期限 */
export async function getSupportMe(
  tx: TenantTx,
  tenantId: string,
  sessionId: string,
): Promise<Me | null> {
  const [row] = await tx
    .select({
      tenantName: tenants.name,
      timeZone: tenants.timeZone,
      staffUserId: supportSessions.staffUserId,
      staffName: supportSessions.staffName,
      staffEmail: supportSessions.staffEmail,
      expiresAt: supportSessions.expiresAt,
    })
    .from(supportSessions)
    .innerJoin(tenants, eq(tenants.tenantId, supportSessions.tenantId))
    .where(and(eq(supportSessions.tenantId, tenantId), eq(supportSessions.id, sessionId)));
  if (!row) return null;
  return {
    userId: row.staffUserId,
    tenantId,
    tenantName: row.tenantName,
    timeZone: row.timeZone,
    email: row.staffEmail,
    name: row.staffName,
    role: "viewer",
    support: { expiresAt: row.expiresAt.toISOString() },
  };
}

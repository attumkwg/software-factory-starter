import type { ExportData, Me, Role } from "@app/shared";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { TenantTx } from "../../db/client.ts";
import { beyondCursor, cursorTime, decodeCursor, toPage } from "../../db/paging.ts";
import type { TenantScope } from "../../db/scope.ts";
import { domains, tenants, users } from "./schema.ts";
import { findIpAllowlist } from "./security.ts";

export async function getMe(s: TenantScope): Promise<Me | null> {
  const [row] = await s.tx
    .select({
      userId: users.id,
      tenantId: users.tenantId,
      tenantName: tenants.name,
      timeZone: tenants.timeZone,
      email: users.email,
      name: users.name,
      role: users.role,
    })
    .from(users)
    .innerJoin(tenants, eq(tenants.tenantId, users.tenantId))
    .where(and(eq(users.tenantId, s.tenantId), eq(users.id, s.userId)));
  return row ?? null;
}

/** 認可の関所(src/authz)が、その組織の中での利用者のロールを引く。いなければ null。 */
export async function findRole(
  tx: TenantTx,
  tenantId: string,
  userId: string,
): Promise<Role | null> {
  const [row] = await tx
    .select({ role: users.role })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
  return row?.role ?? null;
}

/**
 * 知らせ(メール)の宛先。アウトボックスの受け手が、送る直前に読む(出来事の中身にメールを入れないため)。
 * いなければ null(消された人には送らない)。
 */
export async function findContact(
  tx: TenantTx,
  tenantId: string,
  userId: string,
): Promise<{ email: string; name: string } | null> {
  const [row] = await tx
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
  return row ?? null;
}

/** 組織の全員の ID(運営のコマンドが、組織の全員にお知らせを積むときに使う。docs/specs/0009-legal-consent.md) */
export async function listUserIds(tx: TenantTx, tenantId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.tenantId, tenantId))
    .orderBy(asc(users.createdAt), asc(users.id));
  return rows.map((r) => r.id);
}

/** 組織の時間帯(メールに日時を書くとき。ADR 0005)。組織が無ければ null */
export async function findTimeZone(tx: TenantTx, tenantId: string): Promise<string | null> {
  const [row] = await tx
    .select({ timeZone: tenants.timeZone })
    .from(tenants)
    .where(eq(tenants.tenantId, tenantId));
  return row?.timeZone ?? null;
}

/** その人が組織に入った時刻(PMF の兆しを聞くのは、使い始めてしばらくたった人だけ)。いなければ null。 */
export async function findUserSince(
  tx: TenantTx,
  tenantId: string,
  userId: string,
): Promise<Date | null> {
  const [row] = await tx
    .select({ createdAt: users.createdAt })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
  return row?.createdAt ?? null;
}

/** 監査ログの画面に「誰が」を名前で出すため。自社の人だけ(いない人・消された人は返らない)。 */
export async function findUserNames(
  tx: TenantTx,
  tenantId: string,
  userIds: string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = await tx
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), inArray(users.id, userIds)));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** データの書き出し(docs/specs/0005-offboarding.md)。組織 */
export async function exportOrganization(s: TenantScope): Promise<ExportData["organization"]> {
  const [tenant] = await s.tx.select().from(tenants).where(eq(tenants.tenantId, s.tenantId));
  if (!tenant) throw new Error("tenant not found");
  const domainRows = await s.tx
    .select({ domain: domains.domain, verifiedAt: domains.verifiedAt })
    .from(domains)
    .where(eq(domains.tenantId, s.tenantId))
    .orderBy(asc(domains.domain));
  return {
    id: tenant.tenantId,
    name: tenant.name,
    timeZone: tenant.timeZone,
    createdAt: tenant.createdAt.toISOString(),
    // 確かめの文字(verify_token)は入れない
    domains: domainRows.map((d) => ({
      domain: d.domain,
      verifiedAt: d.verifiedAt?.toISOString() ?? null,
    })),
    ipAllowlist: await findIpAllowlist(s.tx, s.tenantId),
  };
}

/**
 * データの書き出し(docs/specs/0018-export-stream.md)。利用者を古い順に1ページずつ。
 * 認証の製品の ID(external_id = Cognito の sub)は入れない(写す項目を決めて、表を丸ごと出さない)。
 */
export async function exportUsersPage(
  s: TenantScope,
  after: string | null,
  limit: number,
): Promise<{ rows: ExportData["users"]; nextCursor: string | null }> {
  const cursor = after ? decodeCursor(after) : null;
  const rows = await s.tx
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      createdAt: users.createdAt,
      cursorAt: cursorTime(users.createdAt),
    })
    .from(users)
    .where(
      and(eq(users.tenantId, s.tenantId), beyondCursor(cursor, "asc", users.createdAt, users.id)),
    )
    .orderBy(asc(users.createdAt), asc(users.id))
    .limit(limit + 1);
  const page = toPage(rows, limit, (r) => ({ at: r.cursorAt, id: r.id }));
  return {
    rows: page.rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
    })),
    nextCursor: page.nextCursor,
  };
}

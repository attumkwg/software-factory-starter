import type { ExportData, Me, Role } from "@app/shared";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { TenantTx } from "../../db/client.ts";
import type { TenantScope } from "../../db/scope.ts";
import { tenants, users } from "./schema.ts";

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

/**
 * データの書き出し(docs/specs/0005-offboarding.md)。組織と利用者。
 * 認証の製品の ID(external_id = Cognito の sub)は入れない(写す項目を決めて、表を丸ごと出さない)。
 */
export async function exportOrganization(
  s: TenantScope,
): Promise<Pick<ExportData, "organization" | "users">> {
  const [tenant] = await s.tx.select().from(tenants).where(eq(tenants.tenantId, s.tenantId));
  if (!tenant) throw new Error("tenant not found");
  const rows = await s.tx
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.tenantId, s.tenantId))
    .orderBy(asc(users.createdAt));
  return {
    organization: {
      id: tenant.tenantId,
      name: tenant.name,
      timeZone: tenant.timeZone,
      createdAt: tenant.createdAt.toISOString(),
    },
    users: rows.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() })),
  };
}

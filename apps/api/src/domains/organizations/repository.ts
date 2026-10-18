import type { Me, Role } from "@app/shared";
import { and, eq } from "drizzle-orm";
import type { TenantTx } from "../../db/client.ts";
import type { TenantScope } from "../../db/scope.ts";
import { tenants, users } from "./schema.ts";

export async function getMe(s: TenantScope): Promise<Me | null> {
  const [row] = await s.tx
    .select({
      userId: users.id,
      tenantId: users.tenantId,
      tenantName: tenants.name,
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

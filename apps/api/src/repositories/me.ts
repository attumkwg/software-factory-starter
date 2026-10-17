import type { Me } from "@app/shared";
import { and, eq } from "drizzle-orm";
import { tenants, users } from "../db/schema.ts";
import type { TenantScope } from "./scope.ts";

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

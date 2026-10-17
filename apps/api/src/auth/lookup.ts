import { sql } from "drizzle-orm";
import type { RootDb } from "../db/client.ts";
import type { Session } from "../env.ts";
import type { LoginIdentity } from "./providers.ts";

/**
 * ログインのときだけ、テナントが決まる前に「この人は誰か」を引く。
 * DB 側の SECURITY DEFINER 関数(drizzle/0001_rls.sql)を通すので、アプリは users を全社分は読めない。
 */
export async function findLogin(db: RootDb, identity: LoginIdentity): Promise<Session | null> {
  const result =
    identity.kind === "email"
      ? await db.execute<{ user_id: string; tenant_id: string }>(
          sql`select user_id, tenant_id from auth_find_user_by_email(${identity.email})`,
        )
      : await db.execute<{ user_id: string; tenant_id: string }>(
          sql`select user_id, tenant_id from auth_find_user_by_external_id(${identity.externalId})`,
        );
  const row = result.rows[0];
  return row ? { userId: row.user_id, tenantId: row.tenant_id } : null;
}

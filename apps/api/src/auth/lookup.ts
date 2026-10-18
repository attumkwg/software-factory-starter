import { sql } from "drizzle-orm";
import type { RootDb } from "../db/client.ts";
import type { Session } from "../env.ts";
import type { LoginIdentity } from "./providers.ts";

type Row = { user_id: string; tenant_id: string };
const toSession = (row: Row | undefined): Session | null =>
  row ? { userId: row.user_id, tenantId: row.tenant_id } : null;

/**
 * ログインのときだけ、テナントが決まる前に「この人は誰か」を引く。
 * DB 側の SECURITY DEFINER 関数(drizzle/0001_rls.sql・0005_login_link.sql)を通すので、
 * アプリは users を全社分は読めない。
 *
 * Cognito の人は、まず sub(external_id)で探す。まだ結びついていない(初めてのログイン)なら、
 * **Cognito が確認済みと言うメール**が users の行と一致し、その行がまだ誰とも結びついていないときだけ結びつける。
 * linked … 今回はじめて結びつけたか(ログに残す)
 */
export async function findLogin(
  db: RootDb,
  identity: LoginIdentity,
): Promise<(Session & { linked: boolean }) | null> {
  if (identity.kind === "email") {
    const r = await db.execute<Row>(
      sql`select user_id, tenant_id from auth_find_user_by_email(${identity.email})`,
    );
    const s = toSession(r.rows[0]);
    return s && { ...s, linked: false };
  }
  const byExternalId = async () =>
    toSession(
      (
        await db.execute<Row>(
          sql`select user_id, tenant_id from auth_find_user_by_external_id(${identity.externalId})`,
        )
      ).rows[0],
    );
  const found = await byExternalId();
  if (found) return { ...found, linked: false };
  if (!identity.verifiedEmail) return null;

  const linked = toSession(
    (
      await db.execute<Row>(
        sql`select user_id, tenant_id from auth_link_external_id(${identity.verifiedEmail}, ${identity.externalId})`,
      )
    ).rows[0],
  );
  if (linked) return { ...linked, linked: true };
  // 同じ人が2つのタブで同時に初めてログインすると、先に結びつけたほうが勝つ。もう一度だけ探す
  const again = await byExternalId();
  return again && { ...again, linked: false };
}

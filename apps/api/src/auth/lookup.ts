import { sql } from "drizzle-orm";
import type { RootDb } from "../db/client.ts";
import { findMemberships } from "../domains/organizations/index.ts";
import type { NewSession } from "../env.ts";
import type { LoginIdentity } from "./providers.ts";

/**
 * ログインのときだけ、テナントが決まる前に「この人は誰か・どの組織に所属しているか」を引く。
 * DB の SECURITY DEFINER 関数(drizzle/0001_rls.sql・0005_login_link.sql・0017_multi_org_expand.sql)を通すので、
 * アプリは users を全社分は読めない。
 *
 * 1人が複数の組織に所属できる(docs/specs/0055-multi-org-membership.md)。入るのは**前回使った組織**
 * (初めてなら一番古い所属)。ほかの組織へは、画面の上の切り替え(POST /api/session/organization)で移る。
 *
 * Cognito の人は、**Cognito が確認済みと言うメール**が users の行と一致し、その行がまだ誰とも結びついていないとき、
 * その行を sub に結びつけてから(毎回。2つ目からの所属のため)、sub で探す。
 * linked … 今回はじめて結びつけたか(ログに残す)
 */
export async function findLogin(
  db: RootDb,
  identity: LoginIdentity,
): Promise<(NewSession & { linked: boolean }) | null> {
  if (identity.kind === "email") {
    const [first] = await findMemberships(db, { externalId: null, email: identity.email });
    return first ? { userId: first.userId, tenantId: first.tenantId, linked: false } : null;
  }
  const bySub = async () => {
    const [first] = await findMemberships(db, { externalId: identity.externalId, email: "" });
    return first ? { userId: first.userId, tenantId: first.tenantId } : null;
  };
  // 確認済みのメールで、まだ結びついていない所属(招待を受けた・運営が足した)を、毎回結びつける。
  // 1人が複数の組織に所属するので、2つ目からの所属も初めてのログインで結びつく(ADR 0066)
  const linked = identity.verifiedEmail
    ? await db.execute<{ user_id: string }>(
        sql`select user_id from auth_link_external_id(${identity.verifiedEmail}, ${identity.externalId})`,
      )
    : { rows: [] };
  // 結びつけた後に、sub で所属を引く(前回の組織の順で選ぶ)。
  // 同じ人が2つのタブで同時に初めてログインすると、先に結びつけたほうが勝つ。その場合も sub で見つかる
  const found = await bySub();
  return found && { ...found, linked: linked.rows.length > 0 };
}

import { sql } from "drizzle-orm";
import type { RootDb } from "../db/client.ts";
import { findMemberships, type Membership } from "../domains/organizations/index.ts";
import type { NewSession } from "../env.ts";
import type { LoginIdentity } from "./providers.ts";

/**
 * ログインのときだけ、テナントが決まる前に「この人は誰か・どの組織に所属しているか」を引く。
 * DB の SECURITY DEFINER 関数(drizzle/0001_rls.sql・0005_login_link.sql・0018_multi_org_expand.sql)を通すので、
 * アプリは users を全社分は読めない。
 *
 * 1人が複数の組織に所属できる(docs/specs/0055-multi-org-membership.md)。入るのは**前回使った組織**
 * (初めてなら一番古い所属)。ほかの組織へは、画面の上の切り替え(POST /api/session/organization)で移る。
 *
 * Cognito の人は、**Cognito が確認済みと言うメール**が users の行と一致し、その行がまだ誰とも結びついていないとき、
 * その行を sub に結びつけてから(毎回。2つ目からの所属のため)、sub で探す。
 * linked … 今回はじめて結びつけたか(ログに残す)
 * accept … その所属に入ってよいか。SSO を必須にした組織を飛ばし、次の所属へ(設計書 0056 の 6)
 */
export async function findLogin(
  db: RootDb,
  identity: LoginIdentity,
  accept: Accept = async () => true,
): Promise<LoginLookup> {
  if (identity.kind === "email") {
    const found = await firstAccepted(
      await findMemberships(db, { externalId: null, email: identity.email }),
      accept,
    );
    return found.session ? { ...found, session: { ...found.session, linked: false } } : found;
  }
  const bySub = async () =>
    firstAccepted(
      await findMemberships(db, { externalId: identity.externalId, email: "" }),
      accept,
    );
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
  return found.session
    ? { ...found, session: { ...found.session, linked: linked.rows.length > 0 } }
    : found;
}

/** その所属に入ってよいか(SSO を必須にした組織へは、パスワードでは入らない) */
type Accept = (m: Membership) => Promise<boolean>;

/**
 * session … 入る所属(無ければ null)。
 * refused … 所属はあったが、どれにも入れなかった(全部が SSO を必須にしている)
 */
export type LoginLookup = {
  session: (NewSession & { linked: boolean }) | null;
  refused: boolean;
};

/** 前回の組織の順に見て、最初に入ってよい所属 */
async function firstAccepted(
  memberships: Membership[],
  accept: Accept,
): Promise<{ session: (NewSession & { linked: boolean }) | null; refused: boolean }> {
  for (const m of memberships) {
    if (await accept(m)) {
      return { session: { userId: m.userId, tenantId: m.tenantId, linked: false }, refused: false };
    }
  }
  return { session: null, refused: memberships.length > 0 };
}

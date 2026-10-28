import { createHash, randomBytes } from "node:crypto";
import { SCIM_TOKENS_MAX, type ScimToken } from "@app/shared";
import { and, asc, count, eq, isNull, type SQL, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { RootDb, TenantTx } from "../../db/client.ts";
import type { TenantScope } from "../../db/scope.ts";
import { ApiError, badRequest } from "../../errors.ts";
import { scimTokens, users } from "./schema.ts";

// 大きなお客さん向けの守りの段2: SCIM(docs/specs/0056-sso-scim-ip-audit-export.md・
// docs/designs/0056-sso-scim-ip-audit-export.md の 2・6)。
//   鍵 … 管理者が作る・取り消す。鍵そのものは持たず SHA-256 のハッシュだけ。鍵から組織を引くのは DB の関数だけ
//   人 … 情シスの道具が作る・名前を直す・止める・戻す。扱えるのは「その組織の確かめたドメインのメールの人」だけ
//        (取引先など SSO の外の人は、道具からは見えない・触れない)。消す = 止める(行は残す。U-5)
// SCIM の形(JSON・絞り込みの式)は src/auth/scim-routes.ts。ここは DB の読み書きだけ。

/** 鍵の頭(漏れたときに、検査の道具が「SCIM の鍵」と見分けられるように) */
const TOKEN_PREFIX = "sfs_scim_";

export const hashScimToken = (token: string) => createHash("sha256").update(token).digest("hex");

const toToken = (r: { id: string; createdAt: Date; lastUsedAt: Date | null }): ScimToken => ({
  id: r.id,
  createdAt: r.createdAt.toISOString(),
  lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
});

// ── 鍵(管理者) ────────────────────────────────────────────────────────────

/** 生きている鍵(作った順)。取り消した鍵は監査ログにだけ残る */
export async function listScimTokens(s: TenantScope): Promise<ScimToken[]> {
  const rows = await s.tx
    .select()
    .from(scimTokens)
    .where(and(eq(scimTokens.tenantId, s.tenantId), isNull(scimTokens.revokedAt)))
    .orderBy(asc(scimTokens.createdAt), asc(scimTokens.id));
  return rows.map(toToken);
}

/** 鍵を作る。返した鍵は二度と出せない。生きている鍵が上限なら 409 */
export async function createScimToken(s: TenantScope): Promise<ScimToken & { token: string }> {
  const [live] = await s.tx
    .select({ n: count() })
    .from(scimTokens)
    .where(and(eq(scimTokens.tenantId, s.tenantId), isNull(scimTokens.revokedAt)));
  if ((live?.n ?? 0) >= SCIM_TOKENS_MAX) {
    throw new ApiError(
      409,
      "too_many_scim_tokens",
      `生きている鍵は ${SCIM_TOKENS_MAX} つまでです。古い鍵を取り消してください`,
    );
  }
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const [row] = await s.tx
    .insert(scimTokens)
    .values({
      id: uuidv7(),
      tenantId: s.tenantId,
      tokenHash: hashScimToken(token),
      createdBy: s.userId,
    })
    .returning();
  if (!row) throw new Error("scim token not inserted");
  return { ...toToken(row), token };
}

/** 鍵を取り消す(戻らない)。無い・取り消し済みなら false */
export async function revokeScimToken(s: TenantScope, tokenId: string): Promise<boolean> {
  const rows = await s.tx
    .update(scimTokens)
    .set({ revokedAt: new Date(), revokedBy: s.userId })
    .where(
      and(
        eq(scimTokens.tenantId, s.tenantId),
        eq(scimTokens.id, tokenId),
        isNull(scimTokens.revokedAt),
      ),
    )
    .returning({ id: scimTokens.id });
  return rows.length > 0;
}

// ── 鍵から組織を決める(組織が決まる前) ──────────────────────────────────────

/** 生きている鍵なら、その鍵の ID と組織。DB の関数(移行 0022)だけが全社分を引ける */
export async function findScimToken(
  db: RootDb,
  token: string,
): Promise<{ tokenId: string; tenantId: string } | null> {
  if (!token.startsWith(TOKEN_PREFIX) || token.length > 200) return null;
  const r = await db.execute<{ token_id: string; tenant_id: string }>(
    sql`select token_id, tenant_id from auth_find_scim_token(${hashScimToken(token)})`,
  );
  const row = r.rows[0];
  return row ? { tokenId: row.token_id, tenantId: row.tenant_id } : null;
}

/** 道具が使った時刻(管理者が「使われているか」を見る) */
export async function touchScimToken(tx: TenantTx, tenantId: string, tokenId: string) {
  await tx
    .update(scimTokens)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(scimTokens.tenantId, tenantId), eq(scimTokens.id, tokenId)));
}

// ── 人(情シスの道具) ──────────────────────────────────────────────────────

/** SCIM で見せる人(形は src/auth/scim-routes.ts が SCIM の JSON にする) */
export type ScimMember = {
  id: string;
  email: string;
  name: string;
  externalId: string | null;
  active: boolean;
  createdAt: Date;
};

const memberColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  externalId: users.scimExternalId,
  disabledAt: users.disabledAt,
  createdAt: users.createdAt,
};
type MemberRow = {
  id: string;
  email: string;
  name: string;
  externalId: string | null;
  disabledAt: Date | null;
  createdAt: Date;
};
const toMember = ({ disabledAt, ...r }: MemberRow): ScimMember => ({
  ...r,
  active: disabledAt === null,
});

/** その組織の確かめたドメインのメールの人(SCIM が扱える人。組織の人の一覧の印にも使う) */
export const inVerifiedDomain = sql`exists (select 1 from organizations.domains d
  where d.tenant_id = ${users.tenantId} and d.verified_at is not null
    and d.domain = split_part(${users.email}, '@', 2))`;

/** 絞り込み(SCIM の filter のうち、道具がよく使う2つだけ) */
export type ScimFilter = { attribute: "userName" | "externalId"; value: string } | null;

function filterSql(filter: ScimFilter): SQL | undefined {
  if (!filter) return undefined;
  return filter.attribute === "userName"
    ? eq(users.email, filter.value.toLowerCase())
    : eq(users.scimExternalId, filter.value);
}

/** 一覧(作った順。SCIM の startIndex は 1 から)。件数も返す */
export async function listScimMembers(
  tx: TenantTx,
  tenantId: string,
  opts: { filter: ScimFilter; startIndex: number; count: number },
): Promise<{ total: number; members: ScimMember[] }> {
  const where = and(eq(users.tenantId, tenantId), inVerifiedDomain, filterSql(opts.filter));
  const [total] = await tx.select({ n: count() }).from(users).where(where);
  const rows =
    opts.count === 0
      ? []
      : await tx
          .select(memberColumns)
          .from(users)
          .where(where)
          .orderBy(asc(users.createdAt), asc(users.id))
          .offset(opts.startIndex - 1)
          .limit(opts.count);
  return { total: total?.n ?? 0, members: rows.map(toMember) };
}

export async function findScimMember(
  tx: TenantTx,
  tenantId: string,
  userId: string,
): Promise<ScimMember | null> {
  const [row] = await tx
    .select(memberColumns)
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.id, userId), inVerifiedDomain));
  return row ? toMember(row) : null;
}

/**
 * 人を作る(ロールは member。変えるのは管理者が画面で)。足すのは DB の関数だけ(ADR 0040・移行 0022)。
 * メールがその組織の確かめたドメインでなければ 400、もういれば 409 already_member
 */
export async function createScimMember(
  tx: TenantTx,
  tenantId: string,
  input: { email: string; name: string; externalId: string | null },
): Promise<ScimMember> {
  try {
    await tx.execute(sql`savepoint scim_create`);
    const r = await tx.execute<{ id: string | null }>(
      sql`select scim_create_user(${tenantId}, ${uuidv7()}, ${input.email}, ${input.name}, ${input.externalId}) as id`,
    );
    const id = r.rows[0]?.id;
    if (!id) throw new Error("scim_create_user: 組織の文脈が違います");
    await tx.execute(sql`release savepoint scim_create`);
    const created = await findScimMember(tx, tenantId, id);
    if (!created) throw new Error("scim member not found after insert");
    return created;
  } catch (e) {
    const cause = ((e as { cause?: unknown }).cause ?? e) as { code?: string; constraint?: string };
    if (cause.code === "23505" && cause.constraint === "users_tenant_email_key") {
      await tx.execute(sql`rollback to savepoint scim_create`);
      throw new ApiError(409, "already_member", "このメールアドレスの人は、もうこの組織にいます");
    }
    // 確かめたドメインのメールではない(DB の関数が check_violation で断る)
    if (cause.code === "23514") {
      await tx.execute(sql`rollback to savepoint scim_create`);
      throw badRequest("メールのドメインが、この組織の確かめたドメインではありません");
    }
    throw e;
  }
}

/**
 * 名前・道具の側の ID・有効かを直す(渡した物だけ)。止めると、その人のこの組織のセッションも切る
 * (強制ログアウトと同じ sessions_valid_after)。無い・扱えない人なら null
 */
export async function updateScimMember(
  tx: TenantTx,
  tenantId: string,
  userId: string,
  change: { name?: string; externalId?: string | null; active?: boolean },
): Promise<ScimMember | null> {
  const before = await findScimMember(tx, tenantId, userId);
  if (!before) return null;
  const now = new Date();
  const set = {
    ...(change.name !== undefined ? { name: change.name } : {}),
    ...(change.externalId !== undefined ? { scimExternalId: change.externalId } : {}),
    ...(change.active === false && before.active
      ? { disabledAt: now, sessionsValidAfter: now }
      : {}),
    ...(change.active === true && !before.active ? { disabledAt: null } : {}),
  };
  if (Object.keys(set).length === 0) return before;
  await tx
    .update(users)
    .set(set)
    .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)));
  return findScimMember(tx, tenantId, userId);
}

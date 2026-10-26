import {
  type FeatureFlagDefinition,
  type PlanDefinition,
  SSO_EXEMPT_MAX,
  type SsoSettings,
} from "@app/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { RootDb, TenantTx } from "../../db/client.ts";
import type { TenantScope } from "../../db/scope.ts";
import { ApiError, badRequest } from "../../errors.ts";
import { isFeatureEnabled } from "../../feature-flags/index.ts";
import { ssoConnections, users } from "./schema.ts";

// 大きなお客さん向けの守りの段1b: SSO の必須と緊急用(docs/specs/0056-sso-scim-ip-audit-export.md・
// docs/designs/0056-sso-scim-ip-audit-export.md の 6・ADR 0067)。IdP をつなぐ・外すのは運営のコマンド(src/sso-commands.ts)。

type Defs = { featureFlags: readonly FeatureFlagDefinition[]; plans: readonly PlanDefinition[] };

/** SSO の必須がこの人に当たるかの材料(認可の関所は findAccess で一緒に引く) */
export type SsoStatus = {
  /** 組織が IdP をつなぎ、必須にしている */
  ssoEnforced: boolean;
  /** この人のメールのドメインが、組織の確かめたドメイン(SSO の中の人) */
  ssoCovered: boolean;
  /** 緊急用のアカウント(管理者のときだけ効く) */
  ssoExempt: boolean;
};

/** findAccess などの select に足す3つ(users の行から。RLS の中で、その組織の行だけを見る) */
export const ssoStatusColumns = {
  ssoEnforced: sql<boolean>`exists (select 1 from organizations.sso_connections s
    where s.tenant_id = ${users.tenantId} and s.required)`,
  ssoCovered: sql<boolean>`exists (select 1 from organizations.domains d
    where d.tenant_id = ${users.tenantId} and d.verified_at is not null
      and d.domain = split_part(${users.email}, '@', 2))`,
  ssoExempt: sql<boolean>`(${users.ssoExempt} and ${users.role} = 'admin')`,
};

/**
 * この人にこの組織で求めること。
 *   sso    … パスワードでは入れない(SSO で入ったセッションだけ)
 *   exempt … 緊急用。パスワードで入れるが、二段階認証が必須
 *   none   … 何も求めない(必須でない・SSO の外の人・プランの機能 sso が無い)
 */
export async function ssoDemandOf(
  tx: TenantTx,
  tenantId: string,
  s: SsoStatus,
  defs: Defs,
): Promise<"sso" | "exempt" | "none"> {
  if (!s.ssoEnforced) return "none";
  if (!(await isFeatureEnabled(tx, tenantId, defs.featureFlags, "sso", defs.plans))) return "none";
  if (s.ssoExempt) return "exempt";
  return s.ssoCovered ? "sso" : "none";
}

/**
 * 二段階認証が要るか: 組織が全員に必須にしている・緊急用のアカウント。SSO で入ったセッションには当てない
 * (IdP の役目。Cognito は IdP から来た人の TOTP を持てない)。関所と GET /api/me が同じ物を使う
 */
export function mfaNeeded(
  access: { mfaRequired: boolean },
  demand: "sso" | "exempt" | "none",
  via: "sso" | undefined,
): boolean {
  return (access.mfaRequired || demand === "exempt") && via !== "sso";
}

export async function findSsoStatus(
  tx: TenantTx,
  tenantId: string,
  userId: string,
): Promise<SsoStatus | null> {
  const [row] = await tx
    .select(ssoStatusColumns)
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)));
  return row ?? null;
}

// 本人は SSO を使う組織の人なので、パスワードが合った後に言ってよい(設計書 0056 の U-7)
export const ssoRequired = () =>
  new ApiError(403, "sso_required", "この組織は会社のアカウントでログインしてください");

/** パスワード(SSO ではない)で、その組織に入ってよいか。ログインと組織の切り替えが呼ぶ */
export async function passwordAllowedIn(
  tx: TenantTx,
  tenantId: string,
  userId: string,
  defs: Defs,
): Promise<boolean> {
  const status = await findSsoStatus(tx, tenantId, userId);
  return !status || (await ssoDemandOf(tx, tenantId, status, defs)) !== "sso";
}

// ── 組織が決まる前(ログインの画面・SSO の戻り) ──────────────────────────────

/** 確かめたドメインに IdP をつないだ組織があれば、IdP の名前(組織の ID は返さない。移行 0021 の関数) */
export async function findSsoProviderByDomain(db: RootDb, domain: string): Promise<string | null> {
  const r = await db.execute<{ provider: string | null }>(
    sql`select auth_find_sso_by_domain(${domain}) as provider`,
  );
  return r.rows[0]?.provider ?? null;
}

/**
 * IdP から戻ってきた人の所属。その IdP の組織で・メールのドメインがその組織の確かめたドメインで・その組織に
 * 行があるときだけ。sub では結びつけない(パスワードで先に結びついた人も、SSO で同じ行に入る。設計書 0056 の 13)
 */
export async function findSsoMember(
  db: RootDb,
  providerName: string,
  email: string,
): Promise<{ userId: string; tenantId: string } | null> {
  const r = await db.execute<{ user_id: string; tenant_id: string }>(
    sql`select user_id, tenant_id from auth_find_sso_member(${providerName}, ${email})`,
  );
  const row = r.rows[0];
  return row ? { userId: row.user_id, tenantId: row.tenant_id } : null;
}

// ── 管理者の設定(GET/PUT /api/organization/sso) ─────────────────────────────

export async function getSsoSettings(s: TenantScope): Promise<SsoSettings> {
  const [conn] = await s.tx
    .select({ required: ssoConnections.required })
    .from(ssoConnections)
    .where(eq(ssoConnections.tenantId, s.tenantId));
  const exempt = await s.tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, s.tenantId), eq(users.ssoExempt, true)))
    .orderBy(users.createdAt, users.id);
  return {
    connected: Boolean(conn),
    required: conn?.required ?? false,
    exemptUserIds: exempt.map((u) => u.id),
  };
}

/**
 * 必須と緊急用を入れ替える。緊急用は管理者だけ・2人まで。必須にするには IdP がつながっていて、緊急用が1人以上
 * (IdP が止まったときに誰も入れないのを避ける。設計書 0056 の 4・U-3)
 */
export async function updateSsoSettings(
  s: TenantScope,
  input: { required: boolean; exemptUserIds: readonly string[] },
): Promise<SsoSettings> {
  const exemptIds = [...new Set(input.exemptUserIds)];
  if (exemptIds.length > SSO_EXEMPT_MAX) throw badRequest(`緊急用は ${SSO_EXEMPT_MAX} 人までです`);
  const admins = exemptIds.length
    ? await s.tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.tenantId, s.tenantId),
            inArray(users.id, exemptIds),
            eq(users.role, "admin"),
          ),
        )
    : [];
  if (admins.length !== exemptIds.length) throw badRequest("緊急用に選べるのは管理者だけです");
  const [conn] = await s.tx
    .select({ id: ssoConnections.id })
    .from(ssoConnections)
    .where(eq(ssoConnections.tenantId, s.tenantId));
  if (input.required && !conn) {
    throw new ApiError(409, "sso_not_connected", "IdP がまだつながっていません");
  }
  if (input.required && exemptIds.length === 0) {
    throw new ApiError(
      409,
      "sso_exempt_required",
      "必須にするには、緊急用の管理者を1人以上選んでください",
    );
  }
  if (conn) {
    await s.tx
      .update(ssoConnections)
      .set({ required: input.required, updatedAt: new Date() })
      .where(eq(ssoConnections.id, conn.id));
  }
  await s.tx
    .update(users)
    .set({ ssoExempt: false })
    .where(and(eq(users.tenantId, s.tenantId), eq(users.ssoExempt, true)));
  if (exemptIds.length) {
    await s.tx
      .update(users)
      .set({ ssoExempt: true })
      .where(and(eq(users.tenantId, s.tenantId), inArray(users.id, exemptIds)));
  }
  return getSsoSettings(s);
}

// ── 運営のコマンド(sso-connect・sso-disconnect。表の持ち主の接続で、組織の文脈の中から) ─────

/** 運営が IdP をつなぐ前の確かめ: 確かめたドメインがあるか・もうつないでいるか */
export async function findSsoConnectState(
  tx: TenantTx,
  tenantId: string,
): Promise<{ verifiedDomains: number; providerName: string | null }> {
  const [domains] = await tx
    .execute<{ n: number }>(
      sql`select count(*)::integer as n from organizations.domains
         where tenant_id = ${tenantId} and verified_at is not null`,
    )
    .then((r) => r.rows);
  const [conn] = await tx
    .select({ providerName: ssoConnections.providerName })
    .from(ssoConnections)
    .where(eq(ssoConnections.tenantId, tenantId));
  return { verifiedDomains: domains?.n ?? 0, providerName: conn?.providerName ?? null };
}

export async function insertSsoConnection(
  tx: TenantTx,
  tenantId: string,
  providerName: string,
): Promise<void> {
  await tx.insert(ssoConnections).values({ id: uuidv7(), tenantId, providerName });
}

/** 外す。必須も一緒に消えるので、そのドメインの人はパスワードで入れるようになる */
export async function deleteSsoConnection(tx: TenantTx, tenantId: string): Promise<boolean> {
  const rows = await tx
    .delete(ssoConnections)
    .where(eq(ssoConnections.tenantId, tenantId))
    .returning({ id: ssoConnections.id });
  return rows.length > 0;
}

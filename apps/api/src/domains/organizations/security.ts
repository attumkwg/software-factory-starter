import { randomBytes } from "node:crypto";
import {
  type FeatureFlagDefinition,
  IP_ALLOWLIST_MAX,
  type OrganizationDomain,
  type PlanDefinition,
} from "@app/shared";
import { and, asc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { TenantTx } from "../../db/client.ts";
import type { TenantScope } from "../../db/scope.ts";
import { ApiError, badRequest, notFound } from "../../errors.ts";
import { isFeatureEnabled } from "../../feature-flags/index.ts";
import { ipInRanges, parseCidr } from "../../http/client-ip.ts";
import { domains, ipAllowlist, users } from "./schema.ts";

// 大きなお客さん向けの守りの段1a(docs/specs/0056-sso-scim-ip-audit-export.md・ADR 0067):
// 会社のドメインの確認(T-8)・組織に入れる IP の範囲。人の一覧と強制ログアウトは members.ts。

/** DNS の TXT を置く名前の頭。_sfs-verify.<ドメイン> に「sfs-verify=<文字>」 */
export const VERIFY_LABEL = "_sfs-verify";
const verifyValue = (token: string) => `sfs-verify=${token}`;

type DomainRow = typeof domains.$inferSelect;
const toDomain = (r: DomainRow): OrganizationDomain => ({
  id: r.id,
  domain: r.domain,
  verifyRecord: { name: `${VERIFY_LABEL}.${r.domain}`, value: verifyValue(r.verifyToken) },
  verifiedAt: r.verifiedAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
});

// ── ドメイン ───────────────────────────────────────────────────────────────

export async function listDomains(s: TenantScope): Promise<OrganizationDomain[]> {
  const rows = await s.tx
    .select()
    .from(domains)
    .where(eq(domains.tenantId, s.tenantId))
    .orderBy(asc(domains.domain));
  return rows.map(toDomain);
}

/** ドメインを登録する(まだ確かめていない)。同じ組織に同じドメインがあれば 409 */
export async function createDomain(s: TenantScope, domain: string): Promise<OrganizationDomain> {
  try {
    const [row] = await s.tx
      .insert(domains)
      .values({
        id: uuidv7(),
        tenantId: s.tenantId,
        domain,
        verifyToken: randomBytes(18).toString("base64url"),
        createdBy: s.userId,
      })
      .returning();
    if (!row) throw new Error("domain not inserted");
    return toDomain(row);
  } catch (e) {
    if (constraintOf(e) === "domains_tenant_domain_key") {
      throw new ApiError(409, "conflict", "このドメインはもう登録してあります");
    }
    throw e;
  }
}

export async function findDomain(
  tx: TenantTx,
  tenantId: string,
  domainId: string,
): Promise<OrganizationDomain | null> {
  const [row] = await tx
    .select()
    .from(domains)
    .where(and(eq(domains.tenantId, tenantId), eq(domains.id, domainId)));
  return row ? toDomain(row) : null;
}

/** DNS で見えた後に、確かめた印を付ける。ほかの組織がもう確かめていれば 409 domain_taken */
export async function markDomainVerified(
  tx: TenantTx,
  tenantId: string,
  domainId: string,
): Promise<OrganizationDomain> {
  try {
    const [row] = await tx
      .update(domains)
      .set({ verifiedAt: new Date() })
      .where(and(eq(domains.tenantId, tenantId), eq(domains.id, domainId)))
      .returning();
    if (!row) throw notFound();
    return toDomain(row);
  } catch (e) {
    if (constraintOf(e) === "domains_verified_domain_key") {
      throw new ApiError(409, "domain_taken", "このドメインは、ほかの組織がもう確かめています");
    }
    throw e;
  }
}

/** DNS の TXT の答えに、確かめの文字があるか */
export function hasVerifyRecord(records: string[][], domain: OrganizationDomain): boolean {
  return records.some((chunks) => chunks.join("") === domain.verifyRecord.value);
}

export async function deleteDomain(s: TenantScope, domainId: string): Promise<boolean> {
  const rows = await s.tx
    .delete(domains)
    .where(and(eq(domains.tenantId, s.tenantId), eq(domains.id, domainId)))
    .returning({ id: domains.id });
  return rows.length > 0;
}

// ── IP の範囲 ──────────────────────────────────────────────────────────────

export async function findIpAllowlist(tx: TenantTx, tenantId: string): Promise<string[]> {
  const rows = await tx
    .select({ cidr: ipAllowlist.cidr })
    .from(ipAllowlist)
    .where(eq(ipAllowlist.tenantId, tenantId))
    .orderBy(asc(ipAllowlist.createdAt), asc(ipAllowlist.id));
  return rows.map((r) => r.cidr);
}

/**
 * 一覧ごと入れ替える。形の違う範囲は 400。いまの IP を含まない(空でない)一覧は 409(自分を締め出さない)。
 * 空にすると制限しない。
 */
export async function replaceIpAllowlist(
  s: TenantScope,
  cidrs: readonly string[],
  yourIp: string | null,
): Promise<string[]> {
  const normalized = [...new Set(cidrs.map((c) => c.trim()))];
  if (normalized.length > IP_ALLOWLIST_MAX) throw badRequest(`${IP_ALLOWLIST_MAX} 個までです`);
  if (normalized.some((c) => !parseCidr(c))) {
    throw badRequest("IP の範囲の形が正しくありません(203.0.113.0/24 の形)");
  }
  if (normalized.length > 0 && !(yourIp && ipInRanges(yourIp, normalized))) {
    throw new ApiError(409, "allowlist_excludes_you", "いまの IP が入っていません");
  }
  await s.tx.delete(ipAllowlist).where(eq(ipAllowlist.tenantId, s.tenantId));
  if (normalized.length > 0) {
    await s.tx.insert(ipAllowlist).values(
      normalized.map((cidr) => ({
        id: uuidv7(),
        tenantId: s.tenantId,
        cidr,
        createdBy: s.userId,
      })),
    );
  }
  return normalized;
}

/**
 * その組織に、いまの IP で入ってよいか。一覧が空・機能が入っていない(プランの外)なら制限しない。
 * 認可の関所(毎回)とログインが呼ぶ。
 */
export async function ipAllowedFor(
  tx: TenantTx,
  tenantId: string,
  ip: string | null,
  defs: { featureFlags: readonly FeatureFlagDefinition[]; plans: readonly PlanDefinition[] },
): Promise<boolean> {
  const cidrs = await findIpAllowlist(tx, tenantId);
  if (cidrs.length === 0) return true;
  const enabled = await isFeatureEnabled(
    tx,
    tenantId,
    defs.featureFlags,
    "ip-allowlist",
    defs.plans,
  );
  if (!enabled) return true;
  return ip !== null && ipInRanges(ip, cidrs);
}

export const ipNotAllowed = () =>
  new ApiError(403, "ip_not_allowed", "この組織は、決めた場所(IP)の外からは入れません");

function constraintOf(e: unknown): string | undefined {
  const cause = ((e as { cause?: unknown }).cause ?? e) as { code?: string; constraint?: string };
  return cause.code === "23505" ? cause.constraint : undefined;
}

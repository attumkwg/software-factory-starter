import { enabledFeatures, type FeatureFlagDefinition, type FeatureFlagName } from "@app/shared";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import type { TenantTx } from "../db/client.ts";
import type { AppEnv } from "../env.ts";
import { notFound } from "../errors.ts";
import { featureFlags } from "./schema.ts";

// 機能フラグの判定(docs/specs/0012-feature-flags-and-usage.md)。リクエストの中では c.var.tx(組織の文脈つき)で読む。

/** その組織に入れた機能の名前(行)。定義に無い名前も混ざる(enabledFeatures が捨てる) */
export async function findOrgFlags(tx: TenantTx, tenantId: string): Promise<string[]> {
  const rows = await tx
    .select({ flag: featureFlags.flag })
    .from(featureFlags)
    .where(eq(featureFlags.tenantId, tenantId));
  return rows.map((r) => r.flag);
}

/** その組織で入っている機能の名前(定義の順)。GET /api/me の features */
export async function findEnabledFeatures(
  tx: TenantTx,
  tenantId: string,
  defs: readonly FeatureFlagDefinition[],
): Promise<string[]> {
  return enabledFeatures(defs, await findOrgFlags(tx, tenantId));
}

/** その組織で、この機能が入っているか */
export async function isFeatureEnabled(
  tx: TenantTx,
  tenantId: string,
  defs: readonly FeatureFlagDefinition[],
  name: string,
): Promise<boolean> {
  const def = defs.find((d) => d.name === name);
  if (!def || def.state === "off") return false;
  if (def.state === "on") return true;
  const [row] = await tx
    .select({ id: featureFlags.id })
    .from(featureFlags)
    .where(and(eq(featureFlags.tenantId, tenantId), eq(featureFlags.flag, name)));
  return row !== undefined;
}

/**
 * 機能の API の守り。ハンドラーの最初で呼ぶ。入っていなければ 404(無い API と同じ形。出していない機能があることを知らせない)。
 * 権限は今までどおり関所が先に決める(入っていても権限が無ければ 403)。
 */
export async function requireFeature(c: Context<AppEnv>, name: FeatureFlagName): Promise<void> {
  const enabled = await isFeatureEnabled(
    c.get("tx"),
    c.get("actor").tenantId,
    c.get("featureFlags"),
    name,
  );
  if (!enabled) throw notFound();
}

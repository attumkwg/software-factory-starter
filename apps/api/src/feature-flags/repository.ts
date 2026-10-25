import {
  enabledFeatures,
  type FeatureFlagDefinition,
  type FeatureFlagName,
  isEnabled,
  PLANS,
  type PlanDefinition,
} from "@app/shared";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import type { TenantTx } from "../db/client.ts";
import type { AppEnv } from "../env.ts";
import { notFound } from "../errors.ts";
import { findPlanFeatures } from "../plans/index.ts";
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

/**
 * その組織で入っている機能の名前(定義の順)。GET /api/me の features。
 * 状態が plan の機能は、いまのプランに入っていれば入っている(docs/specs/0047-plans.md)
 */
export async function findEnabledFeatures(
  tx: TenantTx,
  tenantId: string,
  defs: readonly FeatureFlagDefinition[],
  plans: readonly PlanDefinition[],
): Promise<string[]> {
  const planFeatures = defs.some((d) => d.state === "plan")
    ? await findPlanFeatures(tx, tenantId, plans)
    : [];
  return enabledFeatures(defs, await findOrgFlags(tx, tenantId), planFeatures);
}

/** その組織で、この機能が入っているか */
export async function isFeatureEnabled(
  tx: TenantTx,
  tenantId: string,
  defs: readonly FeatureFlagDefinition[],
  name: string,
  plans: readonly PlanDefinition[] = PLANS,
): Promise<boolean> {
  const def = defs.find((d) => d.name === name);
  if (!def || def.state === "off") return false;
  if (def.state === "on") return true;
  const rows = new Set(await findOrgFlags(tx, tenantId));
  const planFeatures = new Set(
    def.state === "plan" ? await findPlanFeatures(tx, tenantId, plans) : [],
  );
  return isEnabled(def, rows, planFeatures);
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
    c.get("plans"),
  );
  if (!enabled) throw notFound();
}

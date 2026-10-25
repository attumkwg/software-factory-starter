import type { FeatureFlagDefinition } from "@app/shared";
import { and, eq, sql } from "drizzle-orm";
import { MANUAL_AUDIT_ACTIONS, recordAudit } from "../audit/index.ts";
import type { RootDb, TenantTx } from "../db/client.ts";
import { withTenant } from "../db/tenant.ts";
import { findOrgFlags } from "./repository.ts";
import { featureFlags } from "./schema.ts";

// 運営のコマンド feature-flag(cli.ts)の中身。本番の DB に書くので人が打つ(docs/runbooks/feature-flags.md)。
// 接続は移行と同じ表の持ち主。表は FORCE RLS なので、持ち主でも組織の文脈(withTenant)を付けて読み書きする。

// 組織の領域の入口(index.ts)を読むと、GET /api/me → 機能フラグ → 組織の輪になるので、delete-tenant と同じく SQL で確かめる
async function ensureTenant(tx: TenantTx, tenantId: string): Promise<void> {
  const r = await tx.execute(
    sql`select 1 from organizations.tenants where tenant_id = ${tenantId}`,
  );
  if (r.rows.length === 0) throw new Error(`組織がありません: ${tenantId}`);
}

export type FlagLine = { name: string; state: FeatureFlagDefinition["state"]; enabled: boolean };

/** その組織の機能の一覧(定義の順)。組織が無ければ投げる */
export async function showFeatureFlags(
  db: RootDb,
  tenantId: string,
  defs: readonly FeatureFlagDefinition[],
): Promise<FlagLine[]> {
  return withTenant(db, tenantId, async (tx) => {
    await ensureTenant(tx, tenantId);
    const rows = new Set(await findOrgFlags(tx, tenantId));
    return defs.map((d) => ({
      name: d.name,
      state: d.state,
      // 組織ごとの行だけで見る(プランで入る機能は plan のコマンドで見る)
      enabled:
        d.state === "on" || ((d.state === "rollout" || d.state === "plan") && rows.has(d.name)),
    }));
  });
}

export type FlagChange = { flag: string; enabled: boolean; next: boolean; changed: boolean };

/**
 * その組織で機能を入れる(next = true)・切る(false)。execute が false なら変えずに「変えた後」を返すだけ。
 * 変えたら、その組織の監査ログに仕組みとして残す(変わらなかったら残さない)。
 * 止める(何も変えない): 組織が無い・定義に無い名前・状態が rollout ではない
 */
export async function setFeatureFlag(
  db: RootDb,
  tenantId: string,
  name: string,
  next: boolean,
  opts: { defs: readonly FeatureFlagDefinition[]; execute: boolean },
): Promise<FlagChange> {
  const def = opts.defs.find((d) => d.name === name);
  if (!def) throw new Error(`定義に無い機能です: ${name}(@app/shared の FEATURE_FLAGS)`);
  // plan の機能も、プランの外の組織に試しに入れられる(docs/specs/0047-plans.md)
  if (def.state !== "rollout" && def.state !== "plan") {
    throw new Error(
      `${name} は ${def.state}(全部の組織で同じ)なので、組織ごとに変えても効きません。状態を rollout に戻す PR が先です`,
    );
  }
  return withTenant(db, tenantId, async (tx) => {
    await ensureTenant(tx, tenantId);
    const enabled = (await findOrgFlags(tx, tenantId)).includes(name);
    const changed = enabled !== next;
    if (!opts.execute || !changed) return { flag: name, enabled, next, changed };
    if (next) {
      await tx.insert(featureFlags).values({ tenantId, flag: name }).onConflictDoNothing();
    } else {
      await tx
        .delete(featureFlags)
        .where(and(eq(featureFlags.tenantId, tenantId), eq(featureFlags.flag, name)));
    }
    await recordAudit(tx, {
      tenantId,
      actor: { kind: "system", id: null },
      action: next
        ? MANUAL_AUDIT_ACTIONS.featureFlagEnable
        : MANUAL_AUDIT_ACTIONS.featureFlagDisable,
      target: null,
      outcome: "allowed",
      details: { flag: name },
    });
    return { flag: name, enabled: next, next, changed };
  });
}

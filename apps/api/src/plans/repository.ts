import { type OrganizationPlan, type PlanDefinition, toLocalDate } from "@app/shared";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import type { TenantTx } from "../db/client.ts";
import { ApiError } from "../errors.ts";
import { tenantPlans } from "./schema.ts";

// 組織のいまのプランを読む(docs/specs/0047-plans.md)。リクエストの中では c.var.tx(組織の文脈つき)で読む。
// 組織の領域の入口(index.ts)を読むと、組織 → 招待の人数 → プラン → 組織の輪になるので、人と招待は SQL で数える
// (feature-flags/command.ts・offboarding と同じ)。

export type TenantPlanRow = typeof tenantPlans.$inferSelect;

/** 組織の時間帯の「今日」(YYYY-MM-DD)。契約の日付は組織の時間帯で数える(ADR 0005) */
export async function todayIn(tx: TenantTx, tenantId: string, now = new Date()): Promise<string> {
  const r = await tx.execute<{ time_zone: string }>(
    sql`select time_zone from organizations.tenants where tenant_id = ${tenantId}`,
  );
  return toLocalDate(now, r.rows[0]?.time_zone ?? "Asia/Tokyo");
}

/** その日に効いている行(effective_on がその日までで一番新しい行。同じ日なら後から足した方)。無ければ null */
export async function findCurrentPlanRow(
  tx: TenantTx,
  tenantId: string,
  today: string,
): Promise<TenantPlanRow | null> {
  const [row] = await tx
    .select()
    .from(tenantPlans)
    .where(and(eq(tenantPlans.tenantId, tenantId), lte(tenantPlans.effectiveOn, today)))
    .orderBy(desc(tenantPlans.effectiveOn), desc(tenantPlans.createdAt))
    .limit(1);
  return row ?? null;
}

/** いまのプランで入る機能(PLANS の features)。プランが無い・定義に無いプランなら空 */
export async function findPlanFeatures(
  tx: TenantTx,
  tenantId: string,
  plans: readonly PlanDefinition[],
): Promise<readonly string[]> {
  const row = await findCurrentPlanRow(tx, tenantId, await todayIn(tx, tenantId));
  return plans.find((p) => p.id === row?.plan)?.features ?? [];
}

/** いる人と、受けていない(期限内の)招待の数 */
export async function seatUsage(
  tx: TenantTx,
  tenantId: string,
): Promise<{ members: number; pendingInvitations: number }> {
  const r = await tx.execute<{ members: number; pending: number }>(sql`
    select
      (select count(*)::int from organizations.users where tenant_id = ${tenantId}) as members,
      (select count(*)::int from organizations.invitations
        where tenant_id = ${tenantId} and accepted_at is null and revoked_at is null and expires_at > now()) as pending`);
  return { members: r.rows[0]?.members ?? 0, pendingInvitations: r.rows[0]?.pending ?? 0 };
}

/** 管理者の画面に出す、いまのプランと人数(GET /api/organization/plan) */
export async function getOrganizationPlan(
  tx: TenantTx,
  tenantId: string,
  plans: readonly PlanDefinition[],
): Promise<OrganizationPlan> {
  const row = await findCurrentPlanRow(tx, tenantId, await todayIn(tx, tenantId));
  const usage = await seatUsage(tx, tenantId);
  const def = plans.find((p) => p.id === row?.plan);
  return {
    plan:
      row && def
        ? {
            id: def.id,
            label: def.label,
            priceList: row.priceList,
            seats: row.seats,
            seatPolicy: def.seatPolicy,
            priceLockedUntil: row.priceLockedUntil,
            effectiveOn: row.effectiveOn,
          }
        : null,
    ...usage,
  };
}

/**
 * 人を招く前の守り: プランの人数の上限が block で、いる人+受けていない招待が上限に届いていれば 409。
 * プランが無い・上限なし・count なら通す。
 */
export async function ensureSeatAvailable(
  tx: TenantTx,
  tenantId: string,
  plans: readonly PlanDefinition[],
): Promise<void> {
  const row = await findCurrentPlanRow(tx, tenantId, await todayIn(tx, tenantId));
  const def = plans.find((p) => p.id === row?.plan);
  if (!row || !def || row.seats === null || def.seatPolicy !== "block") return;
  const { members, pendingInvitations } = await seatUsage(tx, tenantId);
  if (members + pendingInvitations >= row.seats) {
    throw new ApiError(
      409,
      "seat_limit_reached",
      "プランの人数の上限に届いています(受けていない招待も数えます)",
    );
  }
}

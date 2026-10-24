import type { FeatureFlagDefinition } from "@app/shared";
import { and, eq, lt, sql } from "drizzle-orm";
import type { RootDb } from "../db/client.ts";
import { withTenant } from "../db/tenant.ts";
import { isFeatureEnabled } from "../feature-flags/index.ts";
import { featureUsage } from "./schema.ts";

// 運営のコマンド usage-report・usage-purge(cli.ts)の中身(docs/runbooks/usage-records.md)。
// 接続は表の持ち主。表は FORCE RLS なので、組織ごとに文脈を付けて読み書きし、数だけをまとめる。
// **組織の ID・名前・人の ID は外に出さない**(出すのは数だけ。賭けの小石には割合で書く)。

/** 記録を残す日数(設計書 0012 の U-3)。過ぎた分は usage-purge が消す */
export const USAGE_RETENTION_DAYS = 400;

const DAY = 86_400_000;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** 組織の ID の一覧(コマンド専用の関数。ID だけを返す。移行 0012) */
async function allTenantIds(db: RootDb): Promise<string[]> {
  const r = await db.execute<{ tenant_id: string }>(
    sql`select tenant_id from operator_tenant_ids() as tenant_id order by tenant_id`,
  );
  return r.rows.map((row) => row.tenant_id);
}

export type UsageWeek = { week: string; tenants: number; users: number };
export type UsageReport = {
  feature: string;
  /** この日から数えた(週の始まりの月曜) */
  since: string;
  /** この日まで数えた(今日) */
  until: string;
  /** 数えた組織の数(運営の組織は除く) */
  tenantsTotal: number;
  /** いまこの機能が入っている組織の数 */
  tenantsEnabled: number;
  /** 週(月曜)ごとの、使った組織の数・使った人の数 */
  weeks: UsageWeek[];
};

/** 機能ごとに、週ごとの「使った組織の数・使った人の数」と「いま入っている組織の数」 */
export async function usageReport(
  db: RootDb,
  feature: string,
  opts: {
    weeks: number;
    defs: readonly FeatureFlagDefinition[];
    supportTenantId: string | null;
    now?: Date;
  },
): Promise<UsageReport> {
  const now = opts.now ?? new Date();
  const since = mondayOf(new Date(now.getTime() - (opts.weeks - 1) * 7 * DAY));
  const until = isoDate(now);
  const byWeek = new Map<string, UsageWeek>();
  let tenantsTotal = 0;
  let tenantsEnabled = 0;
  for (const tenantId of await allTenantIds(db)) {
    if (tenantId === opts.supportTenantId) continue;
    tenantsTotal += 1;
    const { enabled, rows } = await withTenant(db, tenantId, async (tx) => ({
      enabled: await isFeatureEnabled(tx, tenantId, opts.defs, feature),
      rows: (
        await tx.execute<{ week: string; users: number }>(
          sql`select to_char(date_trunc('week', day), 'YYYY-MM-DD') as week,
                count(distinct user_id)::int as users
              from platform.feature_usage
              where tenant_id = ${tenantId} and feature = ${feature} and day >= ${since} and day <= ${until}
              group by 1`,
        )
      ).rows,
    }));
    if (enabled) tenantsEnabled += 1;
    for (const row of rows) {
      const w = byWeek.get(row.week) ?? { week: row.week, tenants: 0, users: 0 };
      w.tenants += 1;
      w.users += row.users;
      byWeek.set(row.week, w);
    }
  }
  const weeks = [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week));
  return { feature, since, until, tenantsTotal, tenantsEnabled, weeks };
}

/** その日の週の月曜(UTC の日付として) */
function mondayOf(d: Date): string {
  const day = (d.getUTCDay() + 6) % 7; // 月曜 = 0
  return isoDate(new Date(d.getTime() - day * DAY));
}

/** 保存期間を過ぎた記録を数える(execute なら消す)。全部の組織(運営の組織も) */
export async function purgeUsage(
  db: RootDb,
  opts: { execute: boolean; retentionDays?: number; now?: Date },
): Promise<{ before: string; count: number }> {
  const now = opts.now ?? new Date();
  const before = isoDate(
    new Date(now.getTime() - (opts.retentionDays ?? USAGE_RETENTION_DAYS) * DAY),
  );
  let count = 0;
  for (const tenantId of await allTenantIds(db)) {
    const old = and(eq(featureUsage.tenantId, tenantId), lt(featureUsage.day, before));
    count += await withTenant(db, tenantId, async (tx) => {
      if (opts.execute) {
        return (await tx.delete(featureUsage).where(old).returning({ id: featureUsage.id })).length;
      }
      const r = await tx.select({ n: sql<number>`count(*)::int` }).from(featureUsage).where(old);
      return r[0]?.n ?? 0;
    });
  }
  return { before, count };
}

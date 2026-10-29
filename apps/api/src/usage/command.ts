import {
  addDays,
  type FeatureFlagDefinition,
  mondayOf,
  OPERATOR_TIME_ZONE,
  toLocalDate,
} from "@app/shared";
import { and, eq, lt, sql } from "drizzle-orm";
import type { RootDb } from "../db/client.ts";
import { withTenant } from "../db/tenant.ts";
import { isFeatureEnabled } from "../feature-flags/index.ts";
import {
  RETENTION_SMALL_BELOW,
  type RetentionUnit,
  retention,
  type TenantWeeks,
} from "./retention.ts";
import { featureUsage } from "./schema.ts";

// 運営のコマンド usage-report・usage-purge(cli.ts)の中身(docs/runbooks/usage-records.md)。
// 接続は表の持ち主。表は FORCE RLS なので、組織ごとに文脈を付けて読み書きし、数だけをまとめる。
// **組織の ID・名前・人の ID は外に出さない**(出すのは数だけ。賭けの小石には割合で書く)。

/** 記録を残す日数(設計書 0012 の U-3)。過ぎた分は usage-purge が消す */
export const USAGE_RETENTION_DAYS = 400;

/** 組織の ID の一覧(コマンド専用の関数。ID だけを返す。移行 0012) */
export async function allTenantIds(db: RootDb): Promise<string[]> {
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
/** 継続率(設計書 0022)。始めた週ごとの組の、N 週後もまだ使っている数と割合 */
export type UsageRetention = {
  feature: string;
  /** この週(月曜)から後に初めて使った組だけ */
  cohortsFrom: string;
  /** 数え終わった最後の週(月曜)。今週は途中なので入れない */
  lastFullWeek: string;
  /** 大きさがこれより小さい組・足し合わせは small: true(割合だけで線を判定しない) */
  smallBelow: number;
  /** いまこの機能が入っているのに、一度も使っていない組織の数(どの組にも入らない) */
  enabledNeverUsed: number;
  tenants: RetentionUnit;
  users: RetentionUnit;
};

type ReportOpts = {
  weeks: number;
  defs: readonly FeatureFlagDefinition[];
  supportTenantId: string | null;
  now?: Date;
};
type TenantRead = { enabled: boolean; userWeeks: TenantWeeks };

/** 組織ごとに「いま入っているか」と、人ごとの使った週(人の ID は DB から読み出さない) */
async function readTenants(
  db: RootDb,
  feature: string,
  opts: ReportOpts,
  until: string,
): Promise<TenantRead[]> {
  const read: TenantRead[] = [];
  for (const tenantId of await allTenantIds(db)) {
    if (tenantId === opts.supportTenantId) continue;
    read.push(
      await withTenant(db, tenantId, async (tx) => ({
        enabled: await isFeatureEnabled(tx, tenantId, opts.defs, feature),
        // 始めた週を知るため、数える週より前の記録も読む(保存期間の中だけ残っている)
        userWeeks: (
          await tx.execute<{ weeks: string[] }>(
            sql`select array_agg(distinct to_char(date_trunc('week', day), 'YYYY-MM-DD')) as weeks
                from platform.feature_usage
                where tenant_id = ${tenantId} and feature = ${feature} and day <= ${until}
                group by user_id`,
          )
        ).rows.map((row) => row.weeks),
      })),
    );
  }
  return read;
}

/** 週(since から)ごとの、使った組織の数・使った人の数 */
function weeklyCounts(tenants: readonly TenantRead[], since: string): UsageWeek[] {
  const byWeek = new Map<string, UsageWeek>();
  for (const { userWeeks } of tenants) {
    const users = new Map<string, number>();
    for (const week of userWeeks.flat()) {
      if (week >= since) users.set(week, (users.get(week) ?? 0) + 1);
    }
    for (const [week, n] of users) {
      const w = byWeek.get(week) ?? { week, tenants: 0, users: 0 };
      w.tenants += 1;
      w.users += n;
      byWeek.set(week, w);
    }
  }
  return [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week));
}

/**
 * 機能ごとに、週ごとの「使った組織の数・使った人の数」と「いま入っている組織の数」と、
 * 始めた週ごとの継続率(retention。設計書 0022)
 */
export async function usageReport(
  db: RootDb,
  feature: string,
  opts: ReportOpts,
): Promise<UsageReport & { retention: UsageRetention }> {
  const { since, until, cohortsFrom, lastFullWeek } = reportWindow(
    opts.now ?? new Date(),
    opts.weeks,
  );
  const tenants = await readTenants(db, feature, opts, until);
  return {
    feature,
    since,
    until,
    tenantsTotal: tenants.length,
    tenantsEnabled: tenants.filter((t) => t.enabled).length,
    weeks: weeklyCounts(tenants, since),
    retention: {
      feature,
      cohortsFrom,
      lastFullWeek,
      smallBelow: RETENTION_SMALL_BELOW,
      enabledNeverUsed: tenants.filter((t) => t.enabled && t.userWeeks.length === 0).length,
      ...retention(
        tenants.map((t) => t.userWeeks),
        { from: cohortsFrom, lastFull: lastFullWeek },
      ),
    },
  };
}

/**
 * 数える期間(日付だけ)。「今日」は運営の時間帯で決める(記録の day は組織の時間帯の日付。仕様 0087)。
 * UTC の日付にすると、日本の月曜 0〜9時は「先週」のままで、数え終わった週が1つずれる。
 */
export function reportWindow(
  now: Date,
  weeks: number,
): { since: string; until: string; cohortsFrom: string; lastFullWeek: string } {
  const today = toLocalDate(now, OPERATOR_TIME_ZONE);
  const since = mondayOf(addDays(today, -(weeks - 1) * 7));
  // 保存期間の端より前に始めた組は、始めた週の記録が消えているかもしれないので数えない
  const kept = mondayOf(addDays(today, -(USAGE_RETENTION_DAYS - 6)));
  return {
    since,
    until: today,
    cohortsFrom: since > kept ? since : kept,
    lastFullWeek: mondayOf(addDays(today, -7)),
  };
}

/** 保存期間を過ぎた記録を数える(execute なら消す)。全部の組織(運営の組織も) */
export async function purgeUsage(
  db: RootDb,
  opts: { execute: boolean; retentionDays?: number; now?: Date },
): Promise<{ before: string; count: number }> {
  const today = toLocalDate(opts.now ?? new Date(), OPERATOR_TIME_ZONE);
  const before = addDays(today, -(opts.retentionDays ?? USAGE_RETENTION_DAYS));
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

// ── コマンドの入口(cli.ts)。引数を読み、出す行(JSON 1行+案内)を返す。接続を開く・閉じるのは cli.ts ──

/** usage-report <機能> [--weeks <週の数。既定 8・1〜60>] */
export function parseUsageReportArgs(args: string[]): { feature: string; weeks: number } {
  const [feature, ...flags] = args;
  if (!feature || feature.startsWith("--")) {
    throw new Error("使い方: usage-report <機能> [--weeks <週の数>]");
  }
  const weeksAt = flags.indexOf("--weeks");
  const weeks = weeksAt >= 0 ? Number(flags[weeksAt + 1]) : 8;
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 60) {
    throw new Error("--weeks は 1〜60 の整数です");
  }
  return { feature, weeks };
}

export async function runUsageReport(
  db: RootDb,
  args: string[],
  opts: { defs: readonly FeatureFlagDefinition[]; supportTenantId: string | null; now?: Date },
): Promise<string[]> {
  const { feature, weeks } = parseUsageReportArgs(args);
  const { retention: cohorts, ...report } = await usageReport(db, feature, { weeks, ...opts });
  return [
    JSON.stringify({ mode: "report", ...report }),
    JSON.stringify({ mode: "retention", ...cohorts }),
  ];
}

/** usage-purge [--execute] */
export async function runUsagePurge(
  db: RootDb,
  args: string[],
  opts: { now?: Date } = {},
): Promise<string[]> {
  const execute = args.includes("--execute");
  const done = await purgeUsage(db, { execute, ...opts });
  const line = JSON.stringify({
    mode: execute ? "purged" : "plan",
    days: USAGE_RETENTION_DAYS,
    ...done,
  });
  return execute
    ? [line]
    : [line, "まだ消していません。件数を確かめて --execute を付けて流してください"];
}

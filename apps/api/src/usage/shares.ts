import { sql } from "drizzle-orm";
import type { RootDb } from "../db/client.ts";
import { withTenant } from "../db/tenant.ts";
import { TENANT_TABLES } from "../offboarding/delete-tenant.ts";
import { RETENTION_SMALL_BELOW } from "./retention.ts";

// 運営のコマンド tenant-shares(cli.ts)の中身。1社あたりの原価(費用のページ)の按分の元(docs/designs/0042-tenant-cost.md)。
// 組織ごとに「人数・データの行の数・その月の書き込みの数」を数え、組織の大きさの帯ごとに足した数だけを出す。
// **組織の ID・名前・人の ID は出さない**。要配慮の表(スキーマ sensitive)は数えない(件数も渡さない。AI-6)。

/** 組織の大きさの帯(人数)。値決めの区切りと合わせて直してよい */
export const SIZE_BANDS = [
  { band: "1〜5人", max: 5 },
  { band: "6〜20人", max: 20 },
  { band: "21〜100人", max: 100 },
  { band: "101人〜", max: Number.POSITIVE_INFINITY },
] as const;

/** 1つの組織の数(外に出さない) */
export type TenantMeasure = { users: number; rows: number; writes: number };
export type ShareBand = TenantMeasure & { band: string; tenants: number; small: boolean };
export type TenantShares = {
  month: string;
  tenantsTotal: number;
  smallBelow: number;
  totals: TenantMeasure;
  bands: ShareBand[];
  /** いちばん大きい組織が、全体の何 %(元ごと。組織は元ごとに違うことがある) */
  largestPct: TenantMeasure;
};

const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
const sum = (ms: TenantMeasure[], k: keyof TenantMeasure) => ms.reduce((a, m) => a + m[k], 0);

/** 組織ごとの数を、帯ごとの合計にする(DB を使わない) */
export function sharesOf(month: string, measures: TenantMeasure[]): TenantShares {
  const totals = {
    users: sum(measures, "users"),
    rows: sum(measures, "rows"),
    writes: sum(measures, "writes"),
  };
  const bands = SIZE_BANDS.map((b, i) => {
    const min = i === 0 ? 0 : (SIZE_BANDS[i - 1]?.max ?? 0);
    const inBand = measures.filter((m) => m.users > min && m.users <= b.max);
    return {
      band: b.band,
      tenants: inBand.length,
      small: inBand.length < RETENTION_SMALL_BELOW,
      users: sum(inBand, "users"),
      rows: sum(inBand, "rows"),
      writes: sum(inBand, "writes"),
    };
  }).filter((b) => b.tenants > 0);
  const largest = (k: keyof TenantMeasure) =>
    pct(Math.max(0, ...measures.map((m) => m[k])), totals[k]);
  return {
    month,
    tenantsTotal: measures.length,
    smallBelow: RETENTION_SMALL_BELOW,
    totals,
    bands,
    largestPct: { users: largest("users"), rows: largest("rows"), writes: largest("writes") },
  };
}

const COUNTED = TENANT_TABLES.filter((t) => !t.startsWith("sensitive."));
const table = (name: string) => {
  const [schema, rel] = name.split(".");
  return sql`${sql.identifier(schema as string)}.${sql.identifier(rel as string)}`;
};

/** 組織1つの数(組織の文脈で読む。表は RLS) */
async function measureTenant(
  db: RootDb,
  tenantId: string,
  range: { from: string; to: string },
): Promise<TenantMeasure> {
  return withTenant(db, tenantId, async (tx) => {
    const one = async (q: ReturnType<typeof sql>) =>
      (await tx.execute<{ n: number }>(q)).rows[0]?.n ?? 0;
    let rows = 0;
    for (const t of COUNTED)
      rows += await one(
        sql`select count(*)::int as n from ${table(t)} where tenant_id = ${tenantId}`,
      );
    return {
      users: await one(
        sql`select count(*)::int as n from organizations.users where tenant_id = ${tenantId}`,
      ),
      rows,
      // 人(と代理ログインの社員)の書き込み。仕組みの記録は入れない
      writes: await one(
        sql`select count(*)::int as n from platform.audit_events
            where tenant_id = ${tenantId} and actor_kind <> 'system' and outcome = 'allowed'
              and occurred_at >= ${range.from}::timestamptz and occurred_at < ${range.to}::timestamptz`,
      ),
    };
  });
}

/** 月(YYYY-MM。UTC で区切る)の按分の元。運営の組織は数えない */
export async function tenantShares(
  db: RootDb,
  month: string,
  opts: { supportTenantId: string | null },
): Promise<TenantShares> {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const range = {
    from: `${month}-01T00:00:00Z`,
    to: new Date(Date.UTC(y, m, 1)).toISOString(),
  };
  const ids = await db.execute<{ tenant_id: string }>(
    sql`select tenant_id from operator_tenant_ids() as tenant_id order by tenant_id`,
  );
  const measures: TenantMeasure[] = [];
  for (const { tenant_id } of ids.rows) {
    if (tenant_id === opts.supportTenantId) continue;
    measures.push(await measureTenant(db, tenant_id, range));
  }
  return sharesOf(month, measures);
}

/** tenant-shares [--month YYYY-MM(既定は前の月)] */
export function parseTenantSharesArgs(args: string[], now = new Date()): { month: string } {
  const at = args.indexOf("--month");
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const month = at >= 0 ? String(args[at + 1]) : prev.toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("--month は YYYY-MM です");
  return { month };
}

export async function runTenantShares(
  db: RootDb,
  args: string[],
  opts: { supportTenantId: string | null; now?: Date },
): Promise<string[]> {
  const { month } = parseTenantSharesArgs(args, opts.now);
  const shares = await tenantShares(db, month, opts);
  return [
    JSON.stringify({ mode: "tenant-shares", ...shares }),
    "このまま非公開の置き場の cost/inputs/tenants.json に置く(docs/guides/cost-dashboard.md の 7)",
  ];
}

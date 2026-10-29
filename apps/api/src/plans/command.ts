import {
  addDays,
  currentPriceList,
  DateOnlySchema,
  OPERATOR_TIME_ZONE,
  type PlanDefinition,
  type PriceListDefinition,
  toLocalDate,
} from "@app/shared";
import { desc, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { MANUAL_AUDIT_ACTIONS, recordAudit } from "../audit/index.ts";
import type { RootDb, TenantTx } from "../db/client.ts";
import { withTenant } from "../db/tenant.ts";
import { findCurrentPlanRow, seatUsage, type TenantPlanRow, todayIn } from "./repository.ts";
import { tenantPlans } from "./schema.ts";

// 運営のコマンド plan・plan-report(cli.ts)の中身。本番の DB に書くので人が打つ(docs/runbooks/plans.md)。
// 接続は移行と同じ表の持ち主。表は FORCE RLS なので、持ち主でも組織の文脈(withTenant)を付けて読み書きする。

export type Defs = { plans: readonly PlanDefinition[]; priceLists: readonly PriceListDefinition[] };

export type PlanLine = {
  plan: string;
  priceList: string;
  seats: number | null;
  priceLockedUntil: string | null;
  effectiveOn: string;
};

const toLine = (r: TenantPlanRow): PlanLine => ({
  plan: r.plan,
  priceList: r.priceList,
  seats: r.seats,
  priceLockedUntil: r.priceLockedUntil,
  effectiveOn: r.effectiveOn,
});

async function ensureTenant(tx: TenantTx, tenantId: string): Promise<void> {
  const r = await tx.execute(
    sql`select 1 from organizations.tenants where tenant_id = ${tenantId}`,
  );
  if (r.rows.length === 0) throw new Error(`組織がありません: ${tenantId}`);
}

/** いまのプランと、これまでの契約(新しい順に10件)。組織が無ければ投げる */
export async function showPlan(
  db: RootDb,
  tenantId: string,
): Promise<{ current: PlanLine | null; history: PlanLine[] }> {
  return withTenant(db, tenantId, async (tx) => {
    await ensureTenant(tx, tenantId);
    const current = await findCurrentPlanRow(tx, tenantId, await todayIn(tx, tenantId));
    const history = await tx
      .select()
      .from(tenantPlans)
      .where(eq(tenantPlans.tenantId, tenantId))
      .orderBy(desc(tenantPlans.effectiveOn), desc(tenantPlans.createdAt))
      .limit(10);
    return { current: current && toLine(current), history: history.map(toLine) };
  });
}

/** 運営が渡す変更。省いた項目は、決まり(planChange)で埋める */
export type PlanInput = {
  plan: string;
  priceList?: string | undefined;
  /** null は上限なし。undefined は「いまのまま」 */
  seats?: number | null | undefined;
  /** null は据え置きなし。undefined は決まりで埋める */
  priceLockedUntil?: string | null | undefined;
  effectiveOn?: string | undefined;
};

/**
 * 省いた項目を埋めて、足す行を決める(DB に触らない。単体テストで決まりを確かめる)。
 * - プランを変えないなら(人数だけなど)、価格表と据え置きはいまのまま
 * - **プランを変えたら、その日の価格表に移り、据え置きは消える**(設計書 0047 の U-2)
 * - 人数を省けば、いまのまま(プランが無ければ上限なし)
 */
export function planChange(
  current: PlanLine | null,
  input: PlanInput,
  defs: Defs,
  today: string,
): PlanLine {
  if (!defs.plans.some((p) => p.id === input.plan)) {
    throw new Error(`定義に無いプランです: ${input.plan}(@app/shared の PLANS)`);
  }
  const effectiveOn = checkDate(input.effectiveOn ?? today, "--effective-on");
  // 同じプランのときだけ、いまの行を引き継ぐ
  const same = current?.plan === input.plan ? current : null;
  const priceList = resolvePriceList(input.priceList, same, defs, effectiveOn);
  const priceLockedUntil =
    input.priceLockedUntil !== undefined
      ? input.priceLockedUntil && checkDate(input.priceLockedUntil, "--locked-until")
      : same?.priceList === priceList
        ? same.priceLockedUntil
        : null;
  return {
    plan: input.plan,
    priceList,
    seats: resolveSeats(input.seats, current),
    priceLockedUntil,
    effectiveOn,
  };
}

function checkDate(value: string, flag: string): string {
  if (!DateOnlySchema.safeParse(value).success) throw new Error(`${flag} は YYYY-MM-DD`);
  return value;
}

/** 渡されなければ、同じプランならいまの版・違えばその日の版 */
function resolvePriceList(
  given: string | undefined,
  same: PlanLine | null,
  defs: Defs,
  effectiveOn: string,
): string {
  const priceList = given ?? same?.priceList ?? currentPriceList(defs.priceLists, effectiveOn)?.id;
  if (!priceList || !defs.priceLists.some((l) => l.id === priceList)) {
    throw new Error(
      `定義に無い価格表です: ${priceList ?? "(その日の価格表が無い)"}(@app/shared の PRICE_LISTS)`,
    );
  }
  return priceList;
}

/** 渡されなければいまのまま(初めてなら上限なし) */
function resolveSeats(given: number | null | undefined, current: PlanLine | null): number | null {
  const seats = given !== undefined ? given : (current?.seats ?? null);
  if (seats !== null && (!Number.isInteger(seats) || seats < 1)) {
    throw new Error("--seats は1以上の整数(上限なしは none)");
  }
  return seats;
}

const sameLine = (a: PlanLine | null, b: PlanLine) =>
  a !== null &&
  a.plan === b.plan &&
  a.priceList === b.priceList &&
  a.seats === b.seats &&
  a.priceLockedUntil === b.priceLockedUntil;

export type PlanResult = { current: PlanLine | null; next: PlanLine; changed: boolean };

/**
 * 組織の契約を変える(1行足す)。execute が false なら足さずに「変えた後」を返すだけ。
 * 足したら、その組織の監査ログに仕組みとして残す(details はプランと価格表の名前だけ。人数・日付は行にある)。
 * いまと同じ中身なら足さない(effective_on だけ違っても足さない)。
 */
export async function setPlan(
  db: RootDb,
  tenantId: string,
  input: PlanInput,
  opts: Defs & { execute: boolean },
): Promise<PlanResult> {
  return withTenant(db, tenantId, async (tx) => {
    await ensureTenant(tx, tenantId);
    const today = await todayIn(tx, tenantId);
    const row = await findCurrentPlanRow(tx, tenantId, today);
    const current = row && toLine(row);
    const next = planChange(current, input, opts, today);
    const changed = !sameLine(current, next);
    if (!opts.execute || !changed) return { current, next, changed };
    await insertPlan(tx, tenantId, next);
    return { current, next, changed };
  });
}

/** 行を足して、監査ログに残す(create-tenant の最初のプランもここを通る) */
export async function insertPlan(tx: TenantTx, tenantId: string, line: PlanLine): Promise<void> {
  await tx.insert(tenantPlans).values({ id: uuidv7(), tenantId, ...line });
  await recordAudit(tx, {
    tenantId,
    actor: { kind: "system", id: null },
    action: MANUAL_AUDIT_ACTIONS.planChange,
    target: { type: "organization", id: tenantId },
    outcome: "allowed",
    details: { plan: line.plan, priceList: line.priceList },
  });
}

export type PlanReport = {
  today: string;
  currentPriceList: string | null;
  /** プランと価格表ごとの組織の数(運営の組織は数えない) */
  counts: { plan: string; priceList: string; tenants: number }[];
  /** プランがまだ無い組織の数 */
  withoutPlan: number;
  /** 据え置きの期限が withinDays 日以内に来る・過ぎた組織(いまの価格表ではない物だけ) */
  priceLockEnding: { tenantId: string; priceList: string; priceLockedUntil: string | null }[];
  /** 人数の上限を超えている組織(いる人+受けていない招待) */
  overSeats: { tenantId: string; seats: number; used: number }[];
};

/**
 * 全部の組織の契約を数える(読むだけ)。出すのは組織の ID と数だけ(名前は出さない)。
 * 値上げの前に「据え置きの期限が来る組織」・月ごとに「人数を超えた組織」を見る(docs/runbooks/plans.md)。
 */
export async function planReport(
  db: RootDb,
  opts: Defs & { withinDays: number; supportTenantId: string | null; now?: Date },
): Promise<PlanReport> {
  // 「今日」は運営の時間帯(仕様 0087)
  const today = toLocalDate(opts.now ?? new Date(), OPERATOR_TIME_ZONE);
  const latest = currentPriceList(opts.priceLists, today)?.id ?? null;
  const limit = addDays(today, opts.withinDays);
  const ids = await db.execute<{ tenant_id: string }>(
    sql`select tenant_id from operator_tenant_ids() as tenant_id order by tenant_id`,
  );
  const counts = new Map<string, number>();
  const report: PlanReport = {
    today,
    currentPriceList: latest,
    counts: [],
    withoutPlan: 0,
    priceLockEnding: [],
    overSeats: [],
  };
  for (const { tenant_id: tenantId } of ids.rows) {
    if (tenantId === opts.supportTenantId) continue;
    await withTenant(db, tenantId, async (tx) => {
      const row = await findCurrentPlanRow(tx, tenantId, await todayIn(tx, tenantId, opts.now));
      if (!row) {
        report.withoutPlan += 1;
        return;
      }
      const key = `${row.plan}\u0000${row.priceList}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      await tally(tx, tenantId, row, report, { latest, limit });
    });
  }
  report.counts = [...counts].map(([key, tenants]) => {
    const [plan = "", priceList = ""] = key.split("\u0000");
    return { plan, priceList, tenants };
  });
  return report;
}

/** 1つの組織を、旧価格表(据え置きの期限が limit まで・無い)と人数の超過に振り分ける */
async function tally(
  tx: TenantTx,
  tenantId: string,
  row: TenantPlanRow,
  report: PlanReport,
  opts: { latest: string | null; limit: string },
): Promise<void> {
  const lock = row.priceLockedUntil;
  if (opts.latest && row.priceList !== opts.latest && (lock === null || lock <= opts.limit)) {
    report.priceLockEnding.push({ tenantId, priceList: row.priceList, priceLockedUntil: lock });
  }
  if (row.seats === null) return;
  const usage = await seatUsage(tx, tenantId);
  const used = usage.members + usage.pendingInvitations;
  if (used > row.seats) report.overSeats.push({ tenantId, seats: row.seats, used });
}

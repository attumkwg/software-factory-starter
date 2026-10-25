import { type FeatureFlagDefinition, type FeatureFlagName, toLocalDate } from "@app/shared";
import { sql } from "drizzle-orm";
import type { Context } from "hono";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb, type TenantTx } from "../../src/db/client.ts";
import { withTenant } from "../../src/db/tenant.ts";
import type { Actor, AppEnv } from "../../src/env.ts";
import { setFeatureFlag } from "../../src/feature-flags/index.ts";
import {
  purgeUsage,
  recordUsage,
  runUsagePurge,
  runUsageReport,
  usageReport,
} from "../../src/usage/index.ts";
import { createTenantFixture, type TenantFixture } from "../helpers/fixtures.ts";

// 利用の記録(docs/specs/0012-feature-flags-and-usage.md の「利用の記録」)。2つのお客さん(a・b)と運営(ops)。
// 記録は機能の API のハンドラーの中で呼ぶので、関所を通った後と同じ文脈(組織の文脈つきの tx・行為者)を作って呼ぶ。
// ほかのテストと DB を分け合うので、機能の名前はこのファイルだけの物にする。

const FEATURE = "usage-picked" as FeatureFlagName;
const COHORT = "usage-cohort" as FeatureFlagName;
const DEFS: FeatureFlagDefinition[] = [
  { name: FEATURE, bet: "B-0001", description: "選んだ組織だけ", state: "rollout" },
  { name: COHORT, bet: "B-0001", description: "継続率を数える", state: "rollout" },
];

const owner = createDb(inject("ownerUrl"));
const appDb = createDb(inject("appUrl"));
let a: TenantFixture;
let b: TenantFixture;
let c: TenantFixture;
let ops: TenantFixture;

beforeAll(async () => {
  a = await createTenantFixture(owner.db, "acme");
  b = await createTenantFixture(owner.db, "globex");
  c = await createTenantFixture(owner.db, "initech");
  ops = await createTenantFixture(owner.db, "ops");
});
afterAll(async () => {
  await owner.pool.end();
  await appDb.pool.end();
});

/** 関所を通った後のハンドラーと同じ文脈 */
const handlerContext = (tx: TenantTx, actor: Actor) =>
  ({
    get: (key: string) => ({ tx, actor, supportTenantId: ops.tenantId })[key],
  }) as unknown as Context<AppEnv>;
const userOf = (t: TenantFixture, role: "admin" | "member" | "viewer"): Actor => ({
  tenantId: t.tenantId,
  userId: t.users[role].id,
  role,
});

/** アプリの接続(RLS つき)で、ハンドラーの中から記録する */
const use = (actor: Actor) =>
  withTenant(appDb.db, actor.tenantId, (tx) => recordUsage(handlerContext(tx, actor), FEATURE));

async function rowsOf(tenantId: string) {
  const r = await withTenant(owner.db, tenantId, (tx) =>
    tx.execute<{ user_id: string; feature: string; day: string }>(
      sql`select user_id, feature, to_char(day, 'YYYY-MM-DD') as day from platform.feature_usage
        where tenant_id = ${tenantId} order by user_id`,
    ),
  );
  return r.rows;
}

const insertDay = (
  t: TenantFixture,
  role: "admin" | "member" | "viewer",
  day: string,
  feature: FeatureFlagName = FEATURE,
) =>
  withTenant(owner.db, t.tenantId, (tx) =>
    tx.execute(
      sql`insert into platform.feature_usage (id, tenant_id, user_id, feature, day)
        values (gen_random_uuid(), ${t.tenantId}, ${t.users[role].id}, ${feature}, ${day})`,
    ),
  );

describe("記録する", () => {
  it("組織・人・機能・日(組織の時間帯)だけを1行。同じ日の2回目からは何もしない", async () => {
    await use(userOf(a, "member"));
    await use(userOf(a, "member"));
    await use(userOf(a, "viewer"));
    const tz = await withTenant(owner.db, a.tenantId, (tx) =>
      tx.execute<{ time_zone: string }>(
        sql`select time_zone from organizations.tenants where tenant_id = ${a.tenantId}`,
      ),
    );
    const today = toLocalDate(new Date(), tz.rows[0]?.time_zone as string);
    expect(await rowsOf(a.tenantId)).toEqual(
      [a.users.member.id, a.users.viewer.id]
        .sort()
        .map((user_id) => ({ user_id, feature: FEATURE, day: today })),
    );
    // 他社には何も足していない
    expect(await rowsOf(b.tenantId)).toEqual([]);
  });

  it("代理ログインの社員・運営の組織の人の操作は記録しない", async () => {
    await use({
      ...userOf(b, "viewer"),
      userId: ops.users.member.id,
      support: { sessionId: ops.supportGrantId },
    });
    await use(userOf(ops, "admin"));
    expect(await rowsOf(b.tenantId)).toEqual([]);
    expect(await rowsOf(ops.tenantId)).toEqual([]);
  });

  it("操作が失敗して取り消されたら、記録も残らない(同じトランザクション)", async () => {
    const failed = await withTenant(appDb.db, b.tenantId, async (tx) => {
      await recordUsage(handlerContext(tx, userOf(b, "admin")), FEATURE);
      throw new Error("操作が失敗した");
    }).catch((e: Error) => e.message);
    expect(failed).toBe("操作が失敗した");
    expect(await rowsOf(b.tenantId)).toEqual([]);
  });

  it("アプリの接続は読む・足すだけ(直せない・消せない)。他社の組織の行は足せない(RLS)", async () => {
    const code = (q: ReturnType<typeof sql>) =>
      withTenant(appDb.db, b.tenantId, (tx) =>
        tx.execute(q).then(
          () => "ok",
          (e: { cause?: { code?: string } }) => e.cause?.code,
        ),
      );
    expect(await code(sql`delete from platform.feature_usage`)).toBe("42501");
    expect(await code(sql`update platform.feature_usage set feature = 'x'`)).toBe("42501");
    expect(
      await code(
        sql`insert into platform.feature_usage (id, tenant_id, user_id, feature, day)
          values (gen_random_uuid(), ${a.tenantId}, ${a.users.admin.id}, ${FEATURE}, '2026-01-01')`,
      ),
    ).toBe("42501"); // new row violates row-level security policy
    // b の文脈からは a の記録が見えない
    const seen = await withTenant(appDb.db, b.tenantId, (tx) =>
      tx.execute(sql`select 1 from platform.feature_usage where tenant_id = ${a.tenantId}`),
    );
    expect(seen.rows).toEqual([]);
  });
});

describe("運営のコマンド", () => {
  const now = new Date("2026-10-21T03:00:00Z"); // 水曜(その週の月曜は 10-19)

  it("集計は週ごとの「使った組織の数・人の数」と「入っている組織の数」だけ(ID を出さない・運営の組織は数えない)", async () => {
    await setFeatureFlag(owner.db, a.tenantId, FEATURE, true, { defs: DEFS, execute: true });
    await insertDay(a, "admin", "2026-10-12");
    await insertDay(a, "member", "2026-10-13");
    await insertDay(b, "admin", "2026-10-14");
    await insertDay(a, "admin", "2026-10-20");
    await insertDay(ops, "admin", "2026-10-20");
    await insertDay(b, "viewer", "2026-09-01"); // 数える週より前

    const report = await usageReport(owner.db, FEATURE, {
      weeks: 2,
      defs: DEFS,
      supportTenantId: ops.tenantId,
      now,
    });
    expect(report.since).toBe("2026-10-12");
    expect(report.until).toBe("2026-10-21");
    expect(report.tenantsEnabled).toBe(1);
    expect(report.tenantsTotal).toBeGreaterThanOrEqual(2);
    expect(report.weeks).toEqual([
      { week: "2026-10-12", tenants: 2, users: 3 },
      // 「記録する」で足した今日の行は now より後なので数えない。運営の組織の行も数えない
      { week: "2026-10-19", tenants: 1, users: 1 },
    ]);
    const text = JSON.stringify(report);
    for (const t of [a, b, c, ops]) {
      expect(text).not.toContain(t.tenantId);
      for (const u of Object.values(t.users)) expect(text).not.toContain(u.id);
    }
  });

  it("保存期間を過ぎた記録だけを消す。試しは数えるだけ", async () => {
    await insertDay(b, "member", "2020-01-01");
    const plan = await purgeUsage(owner.db, { execute: false, retentionDays: 400, now });
    expect(plan).toEqual({ before: "2025-09-16", count: 1 });
    expect((await rowsOf(b.tenantId)).map((r) => r.day)).toContain("2020-01-01");

    expect(await purgeUsage(owner.db, { execute: true, retentionDays: 400, now })).toEqual(plan);
    const days = (await rowsOf(b.tenantId)).map((r) => r.day);
    expect(days).not.toContain("2020-01-01");
    expect(days).toContain("2026-09-01");
  });

  it("コマンドの入口: 出す行は JSON 1行(試しは案内も)。引数が違えば止まる", async () => {
    const [report, cohorts] = await runUsageReport(owner.db, [FEATURE, "--weeks", "2"], {
      defs: DEFS,
      supportTenantId: ops.tenantId,
      now,
    });
    expect(JSON.parse(report as string)).toMatchObject({ mode: "report", feature: FEATURE });
    expect(JSON.parse(cohorts as string)).toMatchObject({ mode: "retention", feature: FEATURE });
    await expect(
      runUsageReport(owner.db, [FEATURE, "--weeks", "0"], { defs: DEFS, supportTenantId: null }),
    ).rejects.toThrow("--weeks は 1〜60 の整数です");
    await expect(
      runUsageReport(owner.db, [], { defs: DEFS, supportTenantId: null }),
    ).rejects.toThrow("使い方");

    const plan = await runUsagePurge(owner.db, [], { now });
    expect(plan).toHaveLength(2);
    expect(JSON.parse(plan[0] as string)).toMatchObject({ mode: "plan", days: 400, count: 0 });
    const done = await runUsagePurge(owner.db, ["--execute"], { now });
    expect(done.map((l) => JSON.parse(l).mode)).toEqual(["purged"]);
  });
});

describe("継続率(docs/specs/0022-usage-retention.md)", () => {
  const now = new Date("2026-10-21T03:00:00Z"); // 水曜(その週の月曜は 10-19)

  it("継続率: 初めて使った週の組ごとに、N 週後の数と割合(数え終わった週まで・ID を出さない)", async () => {
    // 数える週は 09-28・10-05・10-12(数え終わった最後)。今週 10-19 は途中なので N 週後に入れない
    await setFeatureFlag(owner.db, a.tenantId, COHORT, true, { defs: DEFS, execute: true });
    await setFeatureFlag(owner.db, c.tenantId, COHORT, true, { defs: DEFS, execute: true });
    await insertDay(a, "admin", "2026-09-29", COHORT);
    await insertDay(a, "admin", "2026-10-06", COHORT);
    await insertDay(a, "admin", "2026-10-20", COHORT);
    await insertDay(a, "member", "2026-10-13", COHORT);
    await insertDay(b, "admin", "2026-09-30", COHORT);
    await insertDay(b, "viewer", "2026-09-15", COHORT); // 数える週より前に始めた(b は組に入らない)
    await insertDay(b, "viewer", "2026-10-14", COHORT);
    await insertDay(ops, "admin", "2026-09-29", COHORT); // 運営の組織は数えない

    const { retention } = await usageReport(owner.db, COHORT, {
      weeks: 4,
      defs: DEFS,
      supportTenantId: ops.tenantId,
      now,
    });
    expect(retention).toMatchObject({
      cohortsFrom: "2026-09-28",
      lastFullWeek: "2026-10-12",
      smallBelow: 5,
      enabledNeverUsed: 1, // c は入っているのに使っていない
    });
    const full = (after: number, n: number, size: number) => ({
      after,
      active: n,
      activePct: Math.round((n / size) * 100),
      continued: n,
      continuedPct: Math.round((n / size) * 100),
    });
    expect(retention.tenants.cohorts).toEqual([
      { start: "2026-09-28", size: 1, small: true, after: [full(1, 1, 1), full(2, 1, 1)] },
    ]);
    expect(retention.users.cohorts).toEqual([
      { start: "2026-09-28", size: 2, small: true, after: [full(1, 1, 2), full(2, 0, 2)] },
      { start: "2026-10-12", size: 1, small: true, after: [] },
    ]);
    expect(retention.users.overall).toEqual([
      { ...full(1, 1, 2), size: 2, small: true },
      { ...full(2, 0, 2), size: 2, small: true },
    ]);
    const text = JSON.stringify(retention);
    for (const t of [a, b, c, ops]) {
      expect(text).not.toContain(t.tenantId);
      for (const u of Object.values(t.users)) expect(text).not.toContain(u.id);
    }
  });
});

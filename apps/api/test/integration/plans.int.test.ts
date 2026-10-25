import type { FeatureFlagDefinition, OrganizationPlan, PlanDefinition } from "@app/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../../src/db/client.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { createTenant, parseTenantApplication } from "../../src/onboarding/create-tenant.ts";
import { type Defs, planReport, setPlan, showPlan } from "../../src/plans/index.ts";
import {
  call,
  createTenantFixture,
  createTestApp,
  login,
  type TenantFixture,
} from "../helpers/fixtures.ts";

// 契約のプラン(docs/specs/0047-plans.md)の受け入れ条件。2社(a・b)で。
// キットのプランには機能が無いので、機能つきのプランと plan の機能を差し替えたアプリで確かめる。

const FLAGS: FeatureFlagDefinition[] = [
  { name: "pro-only", bet: "B-0001", description: "上のプランだけ", state: "plan" },
];
const PLANS: PlanDefinition[] = [
  { id: "standard", label: "スタンダード", features: [], seatPolicy: "block" },
  { id: "pro", label: "プロ", features: ["pro-only"], seatPolicy: "count" },
];
const DEFS: Defs = {
  plans: PLANS,
  priceLists: [
    { id: "2026-10", effectiveFrom: "2026-10-01", description: "最初" },
    { id: "2099-01", effectiveFrom: "2099-01-01", description: "ずっと先の値上げ" },
  ],
};

const owner = createDb(inject("ownerUrl"));
let a: TenantFixture;
let b: TenantFixture;
let app: ReturnType<typeof createTestApp>["app"];
let pool: ReturnType<typeof createTestApp>["pool"];
let aAdmin: string;
let bAdmin: string;

beforeAll(async () => {
  a = await createTenantFixture(owner.db, "acme");
  b = await createTenantFixture(owner.db, "globex");
  ({ app, pool } = createTestApp(inject("appUrl"), {}, { featureFlags: FLAGS, plans: PLANS }));
  aAdmin = await login(app, a.users.admin.email);
  bAdmin = await login(app, b.users.admin.email);
});
afterAll(async () => {
  await owner.pool.end();
  await pool.end();
});

const set = (tenantId: string, input: Parameters<typeof setPlan>[2], execute = true) =>
  setPlan(owner.db, tenantId, input, { ...DEFS, execute });

async function planOf(cookie: string): Promise<OrganizationPlan> {
  const res = await call(app, "GET", "/api/organization/plan", { cookie });
  expect(res.status).toBe(200);
  return (await res.json()) as OrganizationPlan;
}

async function auditRows(tenantId: string) {
  const r = await withTenant(owner.db, tenantId, (tx) =>
    tx.execute<{ action: string; actor_kind: string; details: unknown }>(
      sql`select action, actor_kind, details from platform.audit_events
        where tenant_id = ${tenantId} and action = 'plan.change' order by id`,
    ),
  );
  return r.rows;
}

const invite = (cookie: string, email: string) =>
  call(app, "POST", "/api/invitations", { cookie, body: { email, role: "member" } });

describe("運営のコマンド plan", () => {
  it("試しは何も足さない。本番で1行足し、その組織の監査ログに名前だけ残る。同じ中身なら足さない", async () => {
    const t = await createTenantFixture(owner.db, "plan-cmd");
    expect((await showPlan(owner.db, t.tenantId)).current).toBeNull();
    const dry = await set(t.tenantId, { plan: "standard", seats: 5 }, false);
    expect(dry).toMatchObject({ current: null, changed: true });
    expect((await showPlan(owner.db, t.tenantId)).history).toEqual([]);

    const done = await set(t.tenantId, { plan: "standard", seats: 5 });
    expect(done.next).toMatchObject({ plan: "standard", priceList: "2026-10", seats: 5 });
    expect((await showPlan(owner.db, t.tenantId)).current).toMatchObject({ seats: 5 });
    expect(await auditRows(t.tenantId)).toEqual([
      {
        action: "plan.change",
        actor_kind: "system",
        details: { plan: "standard", priceList: "2026-10" },
      },
    ]);
    expect((await set(t.tenantId, { plan: "standard" })).changed).toBe(false);
    expect(await auditRows(t.tenantId)).toHaveLength(1);
  });

  it("先の日付の契約は、その日が来るまで効かない(いまのプランはそのまま)", async () => {
    const t = await createTenantFixture(owner.db, "plan-future");
    await set(t.tenantId, { plan: "standard", seats: 5 });
    await set(t.tenantId, { plan: "pro", effectiveOn: "2098-12-31" });
    const shown = await showPlan(owner.db, t.tenantId);
    expect(shown.current).toMatchObject({ plan: "standard" });
    expect(shown.history.map((h) => h.plan)).toEqual(["pro", "standard"]);
  });

  it("無い組織・定義に無いプランは止める", async () => {
    await expect(set("00000000-0000-7000-8000-000000000000", { plan: "standard" })).rejects.toThrow(
      /組織がありません/,
    );
    await expect(set(a.tenantId, { plan: "gold" }, false)).rejects.toThrow(/プラン/);
  });
});

describe("管理者が見るプランと人数(GET /api/organization/plan)", () => {
  it("自社のプランと、いる人・受けていない招待の数。プランの無い組織は null", async () => {
    const t = await createTenantFixture(owner.db, "plan-view");
    const cookie = await login(app, t.users.admin.email);
    expect(await planOf(cookie)).toEqual({ plan: null, members: 3, pendingInvitations: 1 });
    await set(t.tenantId, { plan: "standard", seats: 10, priceLockedUntil: "2099-12-31" });
    expect(await planOf(cookie)).toMatchObject({
      plan: {
        id: "standard",
        label: "スタンダード",
        priceList: "2026-10",
        seats: 10,
        seatPolicy: "block",
        priceLockedUntil: "2099-12-31",
      },
      members: 3,
      pendingInvitations: 1,
    });
    // 他社の管理者には、自社(プランの無い b)だけが見える
    expect((await planOf(bAdmin)).plan).toBeNull();
  });
});

describe("人数の上限(招待)", () => {
  it("block のプランは、いる人+受けていない招待が上限に届いたら招けない(409)。上限を外せば招ける", async () => {
    const t = await createTenantFixture(owner.db, "plan-seats");
    const cookie = await login(app, t.users.admin.email);
    // 3人+受けていない招待1件 = 4
    await set(t.tenantId, { plan: "standard", seats: 4 });
    const res = await invite(cookie, `over-${Date.now()}@plan.test`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "seat_limit_reached",
    );
    await set(t.tenantId, { plan: "standard", seats: null });
    expect((await invite(cookie, `ok-${Date.now()}@plan.test`)).status).toBe(201);
  });

  it("count のプランは止めない。プランの無い組織(b)も止めない", async () => {
    const t = await createTenantFixture(owner.db, "plan-count");
    const cookie = await login(app, t.users.admin.email);
    await set(t.tenantId, { plan: "pro", seats: 1 });
    expect((await invite(cookie, `count-${Date.now()}@plan.test`)).status).toBe(201);
    expect((await invite(bAdmin, `b-${Date.now()}@plan.test`)).status).toBe(201);
  });
});

describe("プランで入る機能", () => {
  it("plan の機能は、いまのプランに入っている組織だけに出る(他社には出ない)", async () => {
    await set(a.tenantId, { plan: "pro" });
    const featuresOf = async (cookie: string) =>
      ((await (await call(app, "GET", "/api/me", { cookie })).json()) as { features?: string[] })
        .features;
    expect(await featuresOf(aAdmin)).toEqual(["pro-only"]);
    expect(await featuresOf(bAdmin)).toEqual([]);
    await set(a.tenantId, { plan: "standard" });
    expect(await featuresOf(aAdmin)).toEqual([]);
  });
});

describe("運営のコマンド plan-report(読むだけ)", () => {
  it("旧価格表の組織(据え置きの期限が近い・無い)と、人数を超えた組織を、ID で出す", async () => {
    const locked = await createTenantFixture(owner.db, "plan-lock");
    const over = await createTenantFixture(owner.db, "plan-over");
    await set(locked.tenantId, {
      plan: "standard",
      priceList: "2026-10",
      priceLockedUntil: "2099-01-15",
    });
    await set(over.tenantId, { plan: "pro", seats: 2 });
    const report = await planReport(owner.db, {
      ...DEFS,
      withinDays: 30,
      supportTenantId: null,
      now: new Date("2099-01-02T00:00:00Z"),
    });
    expect(report.currentPriceList).toBe("2099-01");
    expect(report.priceLockEnding).toContainEqual({
      tenantId: locked.tenantId,
      priceList: "2026-10",
      priceLockedUntil: "2099-01-15",
    });
    expect(report.overSeats).toContainEqual({ tenantId: over.tenantId, seats: 2, used: 4 });
    expect(JSON.stringify(report)).not.toMatch(/plan-lock|plan-over|@/);
  });
});

describe("開通のコマンドと申込書のプラン", () => {
  it("申し込みにプランと人数があれば、最初の契約も同じトランザクションで足す", async () => {
    const { application } = parseTenantApplication(
      JSON.stringify({
        name: `プランつき ${Date.now()}`,
        admin: { email: `plan-owner-${Date.now()}@plan.test`, name: "工藤" },
        plan: "standard",
        seats: 10,
      }),
    );
    const done = await createTenant(owner.db, application, {
      execute: true,
      confirmName: application.name,
      supportTenantId: null,
      defs: DEFS,
    });
    expect((await showPlan(owner.db, done.tenantId)).current).toMatchObject({
      plan: "standard",
      priceList: "2026-10",
      seats: 10,
    });
  });

  it("定義に無いプランなら、試しでも止まり、何も作らない", async () => {
    const { application } = parseTenantApplication(
      JSON.stringify({
        name: `無いプラン ${Date.now()}`,
        admin: { email: `bad-plan-${Date.now()}@plan.test`, name: "工藤" },
        plan: "gold",
      }),
    );
    await expect(
      createTenant(owner.db, application, { execute: false, supportTenantId: null, defs: DEFS }),
    ).rejects.toThrow(/プラン/);
  });
});

import {
  type AuditEvent,
  type AuditEventPage,
  type PlanDefinition,
  toLocalDate,
} from "@app/shared";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../../src/db/client.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { auditExportLines } from "../../src/export/audit-routes.ts";
import { setPlan } from "../../src/plans/index.ts";
import {
  call,
  createTenantFixture,
  createTestApp,
  login,
  type TenantFixture,
} from "../helpers/fixtures.ts";

// 大きなお客さん向けの守りの段3: 監査ログの書き出し(docs/specs/0056-sso-scim-ip-audit-export.md)。
// 期間(日付)を選んで JSON Lines で古い順に受け取れる・他社の行が入らない・書き出したことも残る・
// 管理者だけ・プランに audit-export が無い組織は 404。2社(a・b)と、プランの無い組織で確かめる。

const PLANS: PlanDefinition[] = [
  { id: "standard", label: "スタンダード", features: [] },
  { id: "enterprise", label: "エンタープライズ", features: ["audit-export"] },
];
const PRICE_LISTS = [{ id: "2026-10", effectiveFrom: "2026-10-01", description: "最初" }];

const owner = createDb(inject("ownerUrl"));
let app: ReturnType<typeof createTestApp>["app"];
let pool: ReturnType<typeof createTestApp>["pool"];

beforeAll(() => {
  ({ app, pool } = createTestApp(inject("appUrl"), {}, { plans: PLANS }));
});
afterAll(async () => {
  await owner.pool.end();
  await pool.end();
});

type Org = TenantFixture & { admin: string };

async function org(label: string, plan = "enterprise"): Promise<Org> {
  const f = await createTenantFixture(owner.db, label);
  await setPlan(
    owner.db,
    f.tenantId,
    { plan, seats: null },
    { plans: PLANS, priceLists: PRICE_LISTS, execute: true },
  );
  return { ...f, admin: await login(app, f.users.admin.email) };
}

const today = () => toLocalDate(new Date(), "Asia/Tokyo");

async function exportLines(cookie: string, body: { from: string; to: string }) {
  const res = await call(app, "POST", "/api/audit-events/export", { cookie, body });
  if (res.status !== 200) return { status: res.status, events: [] as AuditEvent[], res };
  const text = await res.text();
  const events = text
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as AuditEvent);
  return { status: res.status, events, res };
}

describe("監査ログの書き出し", () => {
  it("期間の自社の行を、古い順に1行1件で。他社の行は入らない", async () => {
    const a = await org("audit-exp-a");
    const b = await org("audit-exp-b");
    for (const name of ["一", "二", "三"]) {
      await call(app, "POST", "/api/projects", { cookie: a.admin, body: { name } });
    }
    await call(app, "POST", "/api/projects", { cookie: b.admin, body: { name: "他社" } });

    const { status, events, res } = await exportLines(a.admin, { from: today(), to: today() });
    expect(status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    expect(res.headers.get("content-disposition")).toContain(".jsonl");
    const creates = events.filter((e) => e.action === "project.create");
    expect(creates).toHaveLength(3);
    const ids = events.map((e) => e.id);
    expect(ids).toEqual([...ids].sort());

    // b の行は1つも入らない(b の管理者が書き出すと、b の行だけ)
    const bOut = await exportLines(b.admin, { from: today(), to: today() });
    expect(bOut.events.filter((e) => e.action === "project.create")).toHaveLength(1);
    const bIds = new Set(bOut.events.map((e) => e.id));
    expect(events.some((e) => bIds.has(e.id))).toBe(false);
  });

  it("期間の外の行は入らない(昨日までを選ぶと今日の行は出ない)", async () => {
    const a = await org("audit-exp-range");
    await call(app, "POST", "/api/projects", { cookie: a.admin, body: { name: "今日" } });
    const yesterday = toLocalDate(new Date(Date.now() - 86_400_000), "Asia/Tokyo");
    const { status, events } = await exportLines(a.admin, { from: "2026-01-01", to: yesterday });
    expect(status).toBe(200);
    expect(events).toEqual([]);
  });

  it("書き出したことが監査ログに残る(期間は入れない)", async () => {
    const a = await org("audit-exp-log");
    await exportLines(a.admin, { from: today(), to: today() });
    const res = await call(app, "GET", "/api/audit-events?limit=10", { cookie: a.admin });
    const page = (await res.json()) as AuditEventPage;
    const row = page.events.find((e) => e.action === "audit.export");
    expect(row?.actor.id).toBe(a.users.admin.id);
    expect(row?.details).toEqual({});
  });

  it("期間の誤り(逆・367 日)は 400。メンバーは 403。プランに無ければ 404", async () => {
    const a = await org("audit-exp-err");
    expect((await exportLines(a.admin, { from: "2026-10-02", to: "2026-10-01" })).status).toBe(400);
    expect((await exportLines(a.admin, { from: "2025-01-01", to: "2026-01-02" })).status).toBe(400);
    expect((await exportLines(a.admin, { from: "2025-01-01", to: "2026-01-01" })).status).toBe(200);
    const member = await login(app, a.users.member.email);
    expect((await exportLines(member, { from: today(), to: today() })).status).toBe(403);
    const c = await org("audit-exp-noplan", "standard");
    expect((await exportLines(c.admin, { from: today(), to: today() })).status).toBe(404);
  });

  it("ページをまたいでも、抜けも重なりも無い(1ページ 2行で読む)", async () => {
    const a = await org("audit-exp-pages");
    for (const name of ["1", "2", "3", "4", "5"]) {
      await call(app, "POST", "/api/projects", { cookie: a.admin, body: { name } });
    }
    const range = { start: new Date(Date.now() - 3_600_000), end: new Date(Date.now() + 60_000) };
    const inTenant = <T>(
      fn: (s: { tx: never; tenantId: string; userId: string }) => Promise<T>,
    ): Promise<T> =>
      withTenant(owner.db, a.tenantId, (tx) =>
        fn({ tx: tx as never, tenantId: a.tenantId, userId: a.users.admin.id }),
      );
    let text = "";
    for await (const chunk of auditExportLines(inTenant, range, 2)) text += chunk;
    const ids = text
      .split("\n")
      .filter(Boolean)
      .map((l) => (JSON.parse(l) as AuditEvent).id);
    expect(ids.length).toBeGreaterThanOrEqual(5);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort());
  });
});

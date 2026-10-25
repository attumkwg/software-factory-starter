import { type CreatedSupportGrant, FEATURE_FLAGS, type PmfSurveyStatus } from "@app/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../../src/db/client.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { setFeatureFlag } from "../../src/feature-flags/index.ts";
import {
  PMF_SURVEY_FLAG,
  pmfSurveyReport,
  purgePmfSurveyAsked,
} from "../../src/pmf-survey/index.ts";
import {
  call,
  createTenantFixture,
  createTestApp,
  login,
  type TenantFixture,
} from "../helpers/fixtures.ts";

// 「無くなったら困るか」を聞く(docs/specs/0046-pmf-survey.md)。
// a … フラグを入れた組織 / b … 入れていない組織 / ops … 運営(代理ログイン用)。
// 聞くのは使い始めて14日たった人だけなので、a と b の member・viewer は「30日前に入った」ことにする(admin は今日入った人のまま)。

const owner = createDb(inject("ownerUrl"));
let a: TenantFixture;
let b: TenantFixture;
let ops: TenantFixture;
let app: ReturnType<typeof createTestApp>["app"];
let pool: ReturnType<typeof createTestApp>["pool"];

async function joinedLongAgo(f: TenantFixture) {
  await withTenant(owner.db, f.tenantId, (tx) =>
    tx.execute(
      sql`update organizations.users set created_at = now() - interval '30 days'
          where tenant_id = ${f.tenantId} and role in ('member', 'viewer')`,
    ),
  );
}

beforeAll(async () => {
  a = await createTenantFixture(owner.db, "acme");
  b = await createTenantFixture(owner.db, "globex");
  ops = await createTenantFixture(owner.db, "ops");
  ({ app, pool } = createTestApp(inject("appUrl"), { SUPPORT_TENANT_ID: ops.tenantId }));
  await setFeatureFlag(owner.db, a.tenantId, PMF_SURVEY_FLAG, true, {
    defs: FEATURE_FLAGS,
    execute: true,
  });
  await setFeatureFlag(owner.db, ops.tenantId, PMF_SURVEY_FLAG, true, {
    defs: FEATURE_FLAGS,
    execute: true,
  });
  await joinedLongAgo(a);
  await joinedLongAgo(b);
  await joinedLongAgo(ops);
});
afterAll(async () => {
  await owner.pool.end();
  await pool.end();
});

const statusOf = async (cookie: string) => {
  const res = await call(app, "GET", "/api/pmf-survey", { cookie });
  expect(res.status).toBe(200);
  return (await res.json()) as PmfSurveyStatus;
};
const answer = (cookie: string, value: string) =>
  call(app, "POST", "/api/pmf-survey", { cookie, body: { answer: value } });

async function countsOf(tenantId: string) {
  const r = await withTenant(owner.db, tenantId, (tx) =>
    tx.execute<{ answer: string; count: string }>(
      sql`select answer, count from platform.pmf_survey_counts where tenant_id = ${tenantId} order by answer`,
    ),
  );
  return r.rows.map((row) => [row.answer, Number(row.count)]);
}

describe("聞く・答える", () => {
  it("入れた組織の、使い始めて14日たった人には聞く。答えると数に1つ足し、その回はもう聞かない(2回目は 409)", async () => {
    const member = await login(app, a.users.member.email);
    const before = await statusOf(member);
    expect(before.ask).toBe(true);
    expect(before.round).toMatch(/^\d{4}-Q[1-4]$/);

    expect((await answer(member, "very_disappointed")).status).toBe(204);
    expect((await statusOf(member)).ask).toBe(false);
    expect((await answer(member, "not_disappointed")).status).toBe(409);

    const viewer = await login(app, a.users.viewer.email);
    expect((await answer(viewer, "very_disappointed")).status).toBe(204);
    expect(await countsOf(a.tenantId)).toEqual([["very_disappointed", 2]]);
  });

  it("だれが何と答えたかは残らない(印には答えが無く、数には人が無い。監査ログにも答えは入らない)", async () => {
    const columns = await owner.db.execute<{ table_name: string; column_name: string }>(
      sql`select table_name, column_name from information_schema.columns
          where table_schema = 'platform' and table_name like 'pmf_survey_%' order by table_name, column_name`,
    );
    const of = (t: string) =>
      columns.rows.filter((r) => r.table_name === t).map((r) => r.column_name);
    expect(of("pmf_survey_asked")).not.toContain("answer");
    expect(of("pmf_survey_counts")).not.toContain("user_id");
    const audit = await withTenant(owner.db, a.tenantId, (tx) =>
      tx.execute<{ details: unknown }>(
        sql`select details from platform.audit_events
            where tenant_id = ${a.tenantId} and action = 'pmf_survey.respond'`,
      ),
    );
    expect(audit.rows.length).toBe(2);
    expect(JSON.stringify(audit.rows)).not.toContain("disappointed");
  });

  it("使い始めて14日より前の人には聞かない(答えても 404)", async () => {
    const admin = await login(app, a.users.admin.email);
    expect((await statusOf(admin)).ask).toBe(false);
    expect((await answer(admin, "very_disappointed")).status).toBe(404);
  });

  it("入れていない組織では聞かない(答えても 404)。他社の数は増えない", async () => {
    const member = await login(app, b.users.member.email);
    expect((await statusOf(member)).ask).toBe(false);
    expect((await answer(member, "very_disappointed")).status).toBe(404);
    expect(await countsOf(b.tenantId)).toEqual([]);
  });

  it("代理の社員は答えられない(403)。運営の組織の人には聞かない", async () => {
    const aAdmin = await login(app, a.users.admin.email);
    const granted = await call(app, "POST", "/api/support-grants", {
      cookie: aAdmin,
      body: { hours: 1 },
    });
    const { code } = (await granted.json()) as CreatedSupportGrant;
    const entered = await call(app, "POST", "/api/support/sessions", {
      cookie: await login(app, ops.users.member.email),
      body: { code },
    });
    expect(entered.status).toBe(201);
    const staff = entered.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect((await statusOf(staff)).ask).toBe(false);
    expect((await answer(staff, "not_disappointed")).status).toBe(403);

    const opsViewer = await login(app, ops.users.viewer.email);
    expect((await statusOf(opsViewer)).ask).toBe(false);
    expect((await answer(opsViewer, "very_disappointed")).status).toBe(404);
  });

  it("答えの形が違えば 400", async () => {
    const member = await login(app, b.users.viewer.email);
    expect((await answer(member, "maybe")).status).toBe(400);
  });
});

describe("運営のコマンド", () => {
  it("集計は全部の組織を足した数と割合だけ(運営の組織は除く。少なければ small)", async () => {
    const round = (await statusOf(await login(app, a.users.member.email))).round;
    const report = await pmfSurveyReport(owner.db, { round, supportTenantId: ops.tenantId });
    expect(report.round).toBe(round);
    expect(report.tenantsAnswered).toBeGreaterThanOrEqual(1);
    expect(report.counts.very_disappointed).toBeGreaterThanOrEqual(2);
    expect(report.answered).toBeGreaterThanOrEqual(2);
    expect(report.veryDisappointedPercent).not.toBeNull();
    expect(report.small).toBe(true);
    expect(JSON.stringify(report)).not.toContain(a.tenantId);
  });

  it("保存期間を過ぎた「聞き終えた印」だけを消す(数は残す)。試しでは消さない", async () => {
    await withTenant(owner.db, a.tenantId, (tx) =>
      tx.execute(
        sql`update platform.pmf_survey_asked set day = (now() - interval '500 days')::date
            where tenant_id = ${a.tenantId} and user_id = ${a.users.viewer.id}`,
      ),
    );
    const plan = await purgePmfSurveyAsked(owner.db, { execute: false });
    expect(plan.count).toBeGreaterThanOrEqual(1);
    const done = await purgePmfSurveyAsked(owner.db, { execute: true });
    expect(done.count).toBe(plan.count);
    expect((await purgePmfSurveyAsked(owner.db, { execute: false })).count).toBe(0);
    expect(await countsOf(a.tenantId)).toEqual([["very_disappointed", 2]]);
  });
});

import type { Me, OrganizationMembershipList, PlanDefinition } from "@app/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { findLogin } from "../../src/auth/lookup.ts";
import { createDb } from "../../src/db/client.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { endOtherSessions, setMfaEnabled } from "../../src/domains/organizations/index.ts";
import { planTenantDeletion } from "../../src/offboarding/delete-tenant.ts";
import { planPersonData } from "../../src/person-data/plan-person-data.ts";
import { setPlan } from "../../src/plans/index.ts";
import {
  call,
  createTenantFixture,
  createTestApp,
  login,
  type TenantFixture,
} from "../helpers/fixtures.ts";
import { createIsolatedDatabase } from "../helpers/isolated-db.ts";

// 1人が複数の組織に所属する形(docs/specs/0055-multi-org-membership.md・ADR 0066)。
// 全体の一意は段 ③ の移行(0018)で消えた。このファイルは、所属を足した組織の数え方を確かめるので自分だけの DB を使う。

const urls = await createIsolatedDatabase(inject("adminUrl"), "multi_org");
const owner = createDb(urls.ownerUrl);
const appDb = createDb(urls.appUrl);
let a: TenantFixture;
let b: TenantFixture;
let c: TenantFixture;
let ops: TenantFixture;
let app: ReturnType<typeof createTestApp>["app"];
let pool: ReturnType<typeof createTestApp>["pool"];
/** b での、a のメンバーと同じ人の行 */
let personInB: string;
const SUB = "sub-multi-org-person";

beforeAll(async () => {
  a = await createTenantFixture(owner.db, "acme");
  b = await createTenantFixture(owner.db, "globex");
  c = await createTenantFixture(owner.db, "initech");
  ops = await createTenantFixture(owner.db, "ops");
  // a のメンバーを、b にも閲覧者として足す(同じメール・別の名前)。同意は fixture と同じく済ませる
  personInB = (
    await withTenant(owner.db, b.tenantId, (tx) =>
      tx.execute<{ id: string }>(sql`
        insert into organizations.users (id, tenant_id, email, name, role)
        values (gen_random_uuid(), ${b.tenantId}, ${a.users.member.email}, 'B での名前', 'viewer')
        returning id`),
    )
  ).rows[0]?.id as string;
  await withTenant(owner.db, b.tenantId, (tx) =>
    tx.execute(sql`
      insert into legal.consents (id, tenant_id, user_id, document, version, capacity, source)
      select gen_random_uuid(), tenant_id, ${personInB}, document, version, 'individual', 'acceptance'
        from legal.consents where tenant_id = ${b.tenantId} and user_id = ${b.users.viewer.id}`),
  );
  ({ app, pool } = createTestApp(urls.appUrl, { SUPPORT_TENANT_ID: ops.tenantId }));
});
afterAll(async () => {
  await owner.pool.end();
  await appDb.pool.end();
  await pool.end();
});

const me = async (cookie: string) =>
  (await (await call(app, "GET", "/api/me", { cookie })).json()) as Me;

/** 選び直した Cookie(Set-Cookie)を受け取る */
async function switchTo(cookie: string, tenantId: string) {
  const res = await call(app, "POST", "/api/session/organization", {
    cookie,
    body: { tenantId },
  });
  const next = res.headers.get("set-cookie")?.split(";")[0];
  return { status: res.status, cookie: next ?? cookie };
}

async function auditActions(tenantId: string, actorId: string) {
  const r = await withTenant(owner.db, tenantId, (tx) =>
    tx.execute<{ action: string }>(
      sql`select action from platform.audit_events
        where tenant_id = ${tenantId} and actor_id = ${actorId} and action like 'auth.switch%' order by id`,
    ),
  );
  return r.rows.map((row) => row.action);
}

describe("所属とログイン", () => {
  it("初めてのログインは一番古い所属(a)に入り、所属の数が2と分かる", async () => {
    const cookie = await login(app, a.users.member.email);
    expect(await me(cookie)).toMatchObject({
      tenantId: a.tenantId,
      role: "member",
      organizationsCount: 2,
    });
  });

  it("所属の一覧は本人の2つだけ(いまの組織に印)", async () => {
    const cookie = await login(app, a.users.member.email);
    const list = (await (
      await call(app, "GET", "/api/me/organizations", { cookie })
    ).json()) as OrganizationMembershipList;
    expect(list.organizations.map((o) => [o.tenantId, o.role, o.current]).sort()).toEqual(
      [
        [a.tenantId, "member", true],
        [b.tenantId, "viewer", false],
      ].sort(),
    );
    // 1つの組織だけの人は1つ
    const single = await login(app, c.users.admin.email);
    expect((await me(single)).organizationsCount).toBe(1);
  });
});

describe("組織の選び直し", () => {
  it("所属している b に選び直すと、Cookie が b の所属になり、a の物は見えなくなる。両方の監査ログに残る", async () => {
    const cookie = await login(app, a.users.member.email);
    const next = await switchTo(cookie, b.tenantId);
    expect(next.status).toBe(200);
    expect(await me(next.cookie)).toMatchObject({
      tenantId: b.tenantId,
      userId: personInB,
      role: "viewer",
      name: "B での名前",
    });
    expect(
      (await call(app, "GET", `/api/projects/${a.projectId}`, { cookie: next.cookie })).status,
    ).toBe(404);
    expect(
      (await call(app, "GET", `/api/projects/${b.projectId}`, { cookie: next.cookie })).status,
    ).toBe(200);
    expect(await auditActions(a.tenantId, a.users.member.id)).toContain("auth.switch_out");
    expect(await auditActions(b.tenantId, personInB)).toContain("auth.switch_in");
  });

  it("次のログインは、前回使った組織(b)に入る", async () => {
    const cookie = await login(app, a.users.member.email);
    await switchTo(cookie, b.tenantId);
    expect((await me(await login(app, a.users.member.email))).tenantId).toBe(b.tenantId);
    // 戻しておく
    const back = await login(app, a.users.member.email);
    await switchTo(back, a.tenantId);
  });

  it("所属していない組織・無い組織は 404(他社の存在を言わない)", async () => {
    const cookie = await login(app, a.users.member.email);
    expect((await switchTo(cookie, c.tenantId)).status).toBe(404);
    expect((await switchTo(cookie, "00000000-0000-7000-8000-000000000000")).status).toBe(404);
  });

  it("先の組織が IP の範囲を決めていれば、外の IP からは選び直せない(403 ip_not_allowed。設計書 0056 の 6)", async () => {
    const plans: PlanDefinition[] = [{ id: "enterprise", label: "上", features: ["ip-allowlist"] }];
    await setPlan(
      owner.db,
      b.tenantId,
      { plan: "enterprise", seats: null },
      {
        plans,
        priceLists: [{ id: "2026-10", effectiveFrom: "2026-10-01", description: "最初" }],
        execute: true,
      },
    );
    await withTenant(owner.db, b.tenantId, (tx) =>
      tx.execute(sql`insert into organizations.ip_allowlist (id, tenant_id, cidr, created_by)
        values (gen_random_uuid(), ${b.tenantId}, '203.0.113.0/24', ${b.users.admin.id})`),
    );
    const restricted = createTestApp(urls.appUrl, { SUPPORT_TENANT_ID: ops.tenantId }, { plans });
    try {
      const switchFrom = async (ip: string) => {
        const cookie = await login(restricted.app, a.users.member.email);
        return call(restricted.app, "POST", "/api/session/organization", {
          cookie,
          body: { tenantId: b.tenantId },
          headers: { "x-forwarded-for": ip },
        });
      };
      const outside = await switchFrom("198.51.100.7");
      expect(outside.status).toBe(403);
      expect(outside.headers.get("set-cookie")).toBeNull();
      expect((await switchFrom("203.0.113.10")).status).toBe(200);
    } finally {
      // 前回使った組織を a に戻す(後のテストが a を前回の組織とみなす)
      await switchTo(await login(app, a.users.member.email), a.tenantId);
      await restricted.pool.end();
      await withTenant(owner.db, b.tenantId, (tx) =>
        tx.execute(sql`delete from organizations.ip_allowlist where tenant_id = ${b.tenantId}`),
      );
    }
  });

  it("代理ログインの最中は選び直せない(403)", async () => {
    const admin = await login(app, a.users.admin.email);
    const grant = (await (
      await call(app, "POST", "/api/support-grants", { cookie: admin, body: { hours: 1 } })
    ).json()) as { code: string };
    const staff = await login(app, ops.users.member.email);
    const entered = await call(app, "POST", "/api/support/sessions", {
      cookie: staff,
      body: { code: grant.code },
    });
    const acting = entered.headers.get("set-cookie")?.split(";")[0] ?? staff;
    expect((await switchTo(acting, ops.tenantId)).status).toBe(403);
  });
});

describe("人に1つの物は、全部の所属にそろう", () => {
  it("二段階認証の写しと、ほかの端末を切った時刻が、b の所属にも書かれる(sub で結びついた人)", async () => {
    for (const [tenantId, id] of [
      [a.tenantId, a.users.member.id],
      [b.tenantId, personInB],
    ] as const) {
      await withTenant(owner.db, tenantId, (tx) =>
        tx.execute(sql`update organizations.users set external_id = ${SUB} where id = ${id}`),
      );
    }
    const at = new Date("2026-10-25T00:00:00Z");
    await withTenant(appDb.db, a.tenantId, async (tx) => {
      const scope = { tx, tenantId: a.tenantId, userId: a.users.member.id };
      await setMfaEnabled(scope, true);
      await endOtherSessions(scope, at);
    });
    const r = await withTenant(owner.db, b.tenantId, (tx) =>
      tx.execute<{ mfa_enabled: boolean; sessions_valid_after: Date }>(
        sql`select mfa_enabled, sessions_valid_after from organizations.users where id = ${personInB}`,
      ),
    );
    expect(r.rows[0]?.mfa_enabled).toBe(true);
    expect(new Date(r.rows[0]?.sessions_valid_after as Date).toISOString()).toBe(at.toISOString());
  });

  it("Cognito の人(sub)のログインも、前回使った組織に入る", async () => {
    const found = await findLogin(appDb.db, {
      kind: "external",
      externalId: SUB,
      verifiedEmail: null,
    });
    expect(found?.tenantId).toBe(a.tenantId);
  });
});

describe("運営のコマンドと Cognito", () => {
  it("解約の試しは、ほかの組織にも所属している人を Cognito から消す一覧に入れない", async () => {
    const plan = await planTenantDeletion(owner.db, a.tenantId);
    expect(plan?.cognitoSubs).not.toContain(SUB);
    expect(plan?.cognitoSubsInOtherOrgs).toBe(1);
  });

  it("1人分の試しは、ほかの組織での所属の数を出す(組織の名前・ID は出さない)", async () => {
    const plan = await planPersonData(owner.db, a.tenantId, a.users.member.id);
    expect(plan.otherMemberships).toBe(1);
    expect(JSON.stringify(plan)).not.toContain(b.tenantId);
  });
});

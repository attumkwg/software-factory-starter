import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../../src/db/client.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { TENANT_TABLES } from "../../src/offboarding/delete-tenant.ts";
import { PERSON_REFERENCES, planPersonData } from "../../src/person-data/plan-person-data.ts";
import {
  call,
  createTenantFixture,
  createTestApp,
  login,
  type TenantFixture,
} from "../helpers/fixtures.ts";

// 利用者1人分の開示・削除の試し(docs/specs/0048-person-data.md)。2社(a・b)で。

const owner = createDb(inject("ownerUrl"));
let a: TenantFixture;
let b: TenantFixture;
let app: ReturnType<typeof createTestApp>["app"];
let pool: ReturnType<typeof createTestApp>["pool"];

beforeAll(async () => {
  a = await createTenantFixture(owner.db, "acme");
  b = await createTenantFixture(owner.db, "globex");
  ({ app, pool } = createTestApp(inject("appUrl")));
  // a のメンバーに、いくつかの種類の行を作る(ログインの監査ログ・その人のメールへの招待)
  await login(app, a.users.member.email);
  const admin = await login(app, a.users.admin.email);
  // 同じメールに招待は作れない(もういる)ので、表に直接足す(取り消された古い招待のつもり)
  await withTenant(owner.db, a.tenantId, (tx) =>
    tx.execute(sql`insert into organizations.invitations
      (id, tenant_id, email, role, invited_by, expires_at, revoked_at, revoked_by)
      values (gen_random_uuid(), ${a.tenantId}, ${a.users.member.email}, 'member', ${a.users.admin.id},
        now() + interval '1 day', now(), ${a.users.admin.id})`),
  );
  // b にも同じ形の行(数えられないこと)
  await login(app, b.users.member.email);
  await call(app, "GET", "/api/me", { cookie: admin });
});
afterAll(async () => {
  await owner.pool.end();
  await pool.end();
});

describe("利用者を指す列の一覧", () => {
  it("利用者の ID を持つ列(…_by・…user_id・actor_id)は、全部 PERSON_REFERENCES にある", async () => {
    const r = await owner.db.execute<{ t: string; c: string }>(sql`
      select table_schema || '.' || table_name as t, column_name as c
        from information_schema.columns
       where data_type = 'uuid'
         and (column_name like '%\\_by' or column_name like '%user\\_id' or column_name = 'actor_id')
         and table_schema not in ('pg_catalog', 'information_schema', 'drizzle')`);
    // 拾えているか(条件の書き間違いで 0 件になり、黙って通らないように)
    expect(r.rows.length).toBeGreaterThanOrEqual(10);
    const known = new Set(PERSON_REFERENCES.map((p) => `${p.table}.${p.column}`));
    const missing = r.rows.map((row) => `${row.t}.${row.c}`).filter((k) => !known.has(k));
    expect(missing, "plan-person-data.ts の PERSON_REFERENCES に足す").toEqual([]);
  });

  it("一覧の表は、どれも解約で消す表(tenant_id を持つ)", () => {
    const tables = new Set<string>(TENANT_TABLES);
    expect(PERSON_REFERENCES.filter((p) => !tables.has(p.table)).map((p) => p.table)).toEqual([]);
  });
});

describe("1人分の試し", () => {
  it("その人の行が、表と列ごとに数えられ、扱い(匿名化・削除・残す)が付く", async () => {
    const plan = await planPersonData(owner.db, a.tenantId, a.users.member.id);
    expect(plan).toMatchObject({ found: true, cognitoSub: null });
    const lines = Object.fromEntries(plan.lines.map((l) => [`${l.table}.${l.column}`, l]));
    expect(lines["organizations.users.id"]).toMatchObject({ rows: 1, action: "anonymize" });
    expect(lines["organizations.invitations.email"]).toMatchObject({
      rows: 1,
      action: "anonymize",
    });
    // 規約への同意(fixture)とログインの監査ログは残す
    expect(lines["legal.consents.user_id"]?.action).toBe("keep");
    expect(lines["platform.audit_events.actor_id"]?.rows).toBeGreaterThanOrEqual(1);
    const total = plan.lines.reduce((n, l) => n + l.rows, 0);
    expect(plan.totals.anonymize + plan.totals.delete + plan.totals.keep).toBe(total);
  });

  it("ほかの組織の行は数えない(同じ形の行が b にあっても)", async () => {
    const plan = await planPersonData(owner.db, a.tenantId, a.users.member.id);
    const audit = plan.lines.find((l) => l.table === "platform.audit_events");
    const inA = await withTenant(owner.db, a.tenantId, (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from platform.audit_events where actor_id = ${a.users.member.id}`,
      ),
    );
    expect(audit?.rows).toBe(inA.rows[0]?.n);
  });

  it("その組織にいない人(他社の人・無い ID)は found: false で、何も数えない(他社にいるかは言わない)", async () => {
    const other = await planPersonData(owner.db, a.tenantId, b.users.member.id);
    expect(other).toMatchObject({ found: false, lines: [], cognitoSub: null });
  });

  it("何も変えない(前後で行の数が同じ)。出力に名前・メールの値は入らない", async () => {
    const count = () =>
      withTenant(owner.db, a.tenantId, (tx) =>
        tx.execute<{ n: number }>(
          sql`select (select count(*) from organizations.users where tenant_id = ${a.tenantId})
            + (select count(*) from platform.audit_events where tenant_id = ${a.tenantId})
            + (select count(*) from organizations.invitations where tenant_id = ${a.tenantId}) as n`,
        ),
      );
    const before = (await count()).rows[0]?.n;
    const plan = await planPersonData(owner.db, a.tenantId, a.users.member.id);
    expect((await count()).rows[0]?.n).toBe(before);
    expect(JSON.stringify(plan)).not.toContain(a.users.member.email);
  });

  it("Cognito と結びついていれば sub を出す(消すときは Cognito からも消す)", async () => {
    await withTenant(owner.db, a.tenantId, (tx) =>
      tx.execute(
        sql`update organizations.users set external_id = ${`sub-${a.users.viewer.id}`} where id = ${a.users.viewer.id}`,
      ),
    );
    const plan = await planPersonData(owner.db, a.tenantId, a.users.viewer.id);
    expect(plan.cognitoSub).toBe(`sub-${a.users.viewer.id}`);
  });
});

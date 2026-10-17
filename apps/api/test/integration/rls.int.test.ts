import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../../src/db/client.ts";
import { createTenantFixture, type TenantFixture } from "../helpers/fixtures.ts";

// DB だけで「RLS が最後の砦として効いているか」を確かめる。アプリの書き忘れがあっても漏れないこと。

const owner = createDb(inject("ownerUrl"));
const app = new pg.Pool({ connectionString: inject("appUrl"), max: 2 });
let a: TenantFixture;
let b: TenantFixture;

beforeAll(async () => {
  a = await createTenantFixture(owner.db, "a");
  b = await createTenantFixture(owner.db, "b");
});
afterAll(async () => {
  await owner.pool.end();
  await app.end();
});

/** アプリの接続ユーザーで、テナントの文脈つきのトランザクションを1つ流す。 */
async function asTenant<T>(tenantId: string | null, fn: (c: pg.PoolClient) => Promise<T>) {
  const c = await app.connect();
  try {
    await c.query("begin");
    if (tenantId) await c.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(c);
    await c.query("commit");
    return result;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

describe("接続ユーザーの形", () => {
  it("アプリの接続ユーザーは superuser でも BYPASSRLS でもない", async () => {
    const { rows } = await app.query(
      "select rolsuper, rolbypassrls from pg_roles where rolname = current_user",
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it("アプリの接続ユーザーはどの表の持ち主でもない", async () => {
    const { rows } = await app.query(
      "select tablename from pg_tables where schemaname = 'public' and tableowner = current_user",
    );
    expect(rows).toEqual([]);
  });

  it("ログイン用の特別なロール(app_auth)には入っていない", async () => {
    const { rows } = await app.query("select pg_has_role(current_user, 'app_auth', 'member') as m");
    expect(rows[0].m).toBe(false);
  });
});

describe("全テーブル", () => {
  it("public の全テーブルに tenant_id があり、RLS が有効で FORCE も付いている", async () => {
    const { rows } = await owner.pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      has_tenant_id: boolean;
    }>(`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity,
             exists (select 1 from information_schema.columns col
                     where col.table_schema = 'public' and col.table_name = c.relname
                       and col.column_name = 'tenant_id') as has_tenant_id
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname`);
    expect(rows.length).toBeGreaterThan(0);
    const bad = rows.filter((r) => !(r.relrowsecurity && r.relforcerowsecurity && r.has_tenant_id));
    expect(bad.map((r) => r.relname)).toEqual([]);
  });
});

describe("行の分離", () => {
  it("テナントを渡さなければ、1行も見えない", async () => {
    const count = await asTenant(
      null,
      async (c) => (await c.query("select count(*)::int as n from projects")).rows[0].n,
    );
    expect(count).toBe(0);
  });

  it("自社の行だけが見える(他社の ID を直接指定しても見えない)", async () => {
    const rows = await asTenant(
      a.tenantId,
      async (c) =>
        (
          await c.query("select id, tenant_id from projects where id = any($1)", [
            [a.projectId, b.projectId],
          ])
        ).rows,
    );
    expect(rows).toEqual([{ id: a.projectId, tenant_id: a.tenantId }]);
  });

  it("他社の tenant_id では書き込めない(WITH CHECK)", async () => {
    await expect(
      asTenant(a.tenantId, (c) =>
        c.query(
          "insert into projects (id, tenant_id, name, created_by) values (gen_random_uuid(), $1, 'x', $2)",
          [b.tenantId, b.users.admin.id],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("自社の行を他社に付け替えられない", async () => {
    await expect(
      asTenant(a.tenantId, (c) =>
        c.query("update tasks set tenant_id = $1 where id = $2", [b.tenantId, a.taskId]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("他社の行は消せない(0行になるだけ)", async () => {
    const deleted = await asTenant(
      a.tenantId,
      async (c) => (await c.query("delete from tasks where id = $1", [b.taskId])).rowCount,
    );
    expect(deleted).toBe(0);
  });

  it("テナントの文脈はトランザクションの外に漏れない(接続を使い回しても)", async () => {
    const c = await app.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.tenant_id', $1, true)", [a.tenantId]);
      await c.query("commit");
      const { rows } = await c.query("select count(*)::int as n from projects");
      expect(rows[0].n).toBe(0);
    } finally {
      c.release();
    }
  });

  it("アプリは users を直接全社分は読めない(ログイン用の関数は ID の組しか返さない)", async () => {
    const leaked = await asTenant(
      a.tenantId,
      async (c) =>
        (await c.query("select email from users where tenant_id = $1", [b.tenantId])).rows,
    );
    expect(leaked).toEqual([]);
    const found = (
      await app.query("select * from auth_find_user_by_email($1)", [b.users.admin.email])
    ).rows;
    expect(found).toEqual([{ user_id: b.users.admin.id, tenant_id: b.tenantId }]);
  });
});

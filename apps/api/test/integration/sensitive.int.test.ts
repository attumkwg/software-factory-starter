import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../../src/db/client.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { deleteTenant } from "../../src/offboarding/delete-tenant.ts";
import { SealedValueError } from "../../src/sensitive/cipher.ts";
import { type KeyWrapper, localKeyWrapper } from "../../src/sensitive/key-wrapper.ts";
import { createSensitiveStore } from "../../src/sensitive/store.ts";
import { createTenantFixture, type TenantFixture } from "../helpers/fixtures.ts";

// 要配慮個人情報の段1(ADR 0029・docs/designs/0016-sensitive-data-tier1.md の 7)。
// 1. 接続を分ける: アプリ(app_rw)はスキーマ sensitive に入れない・要配慮の接続(app_sensitive)はふつうの表に入れない
// 2. RLS: 要配慮の表も、テナントの文脈が無ければ1行も見えない
// 3. 組織ごとのデータ鍵: 1社1本・DB には包んだ物だけ・鍵の行を消すと暗号文が読めない(暗号による消去)

const owner = createDb(inject("ownerUrl"));
const app = new pg.Pool({ connectionString: inject("appUrl"), max: 1 });
const sens = new pg.Pool({ connectionString: inject("sensitiveUrl"), max: 1 });

/** 包んだ・開いた回数を数える(KMS の呼び出しの数の代わり) */
function countingWrapper(): KeyWrapper & { generated: number; unwrapped: number } {
  const inner = localKeyWrapper();
  const w = {
    generated: 0,
    unwrapped: 0,
    async generate(tenantId: string) {
      w.generated++;
      return inner.generate(tenantId);
    },
    async unwrap(tenantId: string, wrapped: string, kmsKeyId: string) {
      w.unwrapped++;
      return inner.unwrap(tenantId, wrapped, kmsKeyId);
    },
  };
  return w;
}

const wrapper = countingWrapper();
const store = createSensitiveStore({ databaseUrl: inject("sensitiveUrl"), wrapper });
const field = "sensitive.health.diagnosis";

let a: TenantFixture;
let b: TenantFixture;
const scopeOf = (t: TenantFixture) => ({ tenantId: t.tenantId, userId: t.users.admin.id });

beforeAll(async () => {
  a = await createTenantFixture(owner.db, "sens-a");
  b = await createTenantFixture(owner.db, "sens-b");
});
afterAll(async () => {
  await store.close();
  await owner.pool.end();
  await app.end();
  await sens.end();
});

async function asRole<T>(pool: pg.Pool, tenantId: string | null, q: string): Promise<T[]> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    if (tenantId) await c.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    return (await c.query(q)).rows as T[];
  } finally {
    await c.query("rollback");
    c.release();
  }
}

describe("接続を分ける", () => {
  it("アプリの接続(app_rw)は、スキーマ sensitive に入れない", async () => {
    await expect(asRole(app, a.tenantId, "select * from sensitive.tenant_keys")).rejects.toThrow(
      /permission denied for schema sensitive/,
    );
    const [r] = await asRole<{ usage: boolean; member: boolean }>(
      app,
      null,
      `select has_schema_privilege(current_user, 'sensitive', 'USAGE') as usage,
              pg_has_role(current_user, 'app_sensitive', 'member') as member`,
    );
    expect(r).toEqual({ usage: false, member: false });
  });

  it("要配慮の接続(app_sensitive)は、ふつうの表に入れない・ほかのロールに入っていない", async () => {
    await expect(asRole(sens, a.tenantId, "select * from tasks.tasks")).rejects.toThrow(
      /permission denied/,
    );
    await expect(asRole(sens, a.tenantId, "select * from organizations.users")).rejects.toThrow(
      /permission denied/,
    );
    const [r] = await asRole<Record<string, boolean>>(
      sens,
      null,
      `select r.rolsuper as super, r.rolbypassrls as bypass,
              pg_has_role(current_user, 'app_rw', 'member') as rw,
              pg_has_role(current_user, 'app_auth', 'member') as auth
         from pg_roles r where r.rolname = current_user`,
    );
    expect(r).toEqual({ super: false, bypass: false, rw: false, auth: false });
  });

  it("スキーマ sensitive の表は、どれも app_rw に何も渡していない", async () => {
    const { rows } = await owner.pool.query<{ t: string }>(
      `select table_name as t from information_schema.role_table_grants
        where table_schema = 'sensitive' and grantee in ('app_rw', 'app', 'app_auth', 'PUBLIC')`,
    );
    expect(rows).toEqual([]);
  });

  it("要配慮の接続も、データ鍵を書き換える・消すことはできない(消すのは解約のコマンドだけ)", async () => {
    await store.run(scopeOf(a), async () => {});
    for (const q of [
      "update sensitive.tenant_keys set wrapped_key = 'x'",
      "delete from sensitive.tenant_keys",
    ]) {
      await expect(asRole(sens, a.tenantId, q)).rejects.toThrow(/permission denied/);
    }
  });
});

describe("RLS", () => {
  it("テナントの文脈が無ければ、データ鍵は1行も見えない。自社の行だけが見える", async () => {
    await store.run(scopeOf(a), async () => {});
    await store.run(scopeOf(b), async () => {});
    expect(await asRole(sens, null, "select tenant_id from sensitive.tenant_keys")).toEqual([]);
    const rows = await asRole<{ tenant_id: string }>(
      sens,
      a.tenantId,
      "select tenant_id from sensitive.tenant_keys",
    );
    expect(rows).toEqual([{ tenant_id: a.tenantId }]);
  });
});

describe("組織ごとのデータ鍵", () => {
  it("閉じた値は同じ組織で開ける。DB には包んだ鍵だけ(中身の鍵も値も無い)", async () => {
    const sealed = await store.run(scopeOf(a), async (s) =>
      s.seal(field, "row-1", "持病: ぜんそく"),
    );
    expect(sealed).not.toContain("ぜんそく");
    expect(await store.run(scopeOf(a), async (s) => s.open(field, "row-1", sealed))).toBe(
      "持病: ぜんそく",
    );
    const [row] = await asRole<{ kms_key_id: string; wrapped_key: string }>(
      sens,
      a.tenantId,
      "select kms_key_id, wrapped_key from sensitive.tenant_keys",
    );
    expect(row?.kms_key_id).toBe("local");
    expect(row?.wrapped_key.length).toBeGreaterThan(40);
  });

  it("他社の組織では、写した暗号文を開けない(鍵も文脈も違う)", async () => {
    const sealed = await store.run(scopeOf(a), async (s) => s.seal(field, "row-1", "x"));
    await expect(
      store.run(scopeOf(b), async (s) => s.open(field, "row-1", sealed)),
    ).rejects.toThrow(SealedValueError);
  });

  it("鍵は1社1本。作るのは最初の1回だけで、開くのも数分に1回(KMS を毎回呼ばない)", async () => {
    const c = await createTenantFixture(owner.db, "sens-c");
    const before = { ...wrapper };
    await Promise.all([1, 2, 3].map(() => store.run(scopeOf(c), async () => {})));
    await store.run(scopeOf(c), async () => {});
    const rows = await withTenant(owner.db, c.tenantId, (tx) =>
      tx.execute(sql`select count(*)::int as n from sensitive.tenant_keys`),
    );
    expect(rows.rows[0]).toEqual({ n: 1 });
    // 同時の3つは、それぞれ作りに行くことがある(入れるのは1つ・ほかは入った方を開く)。4つ目からはメモリ
    expect(wrapper.generated - before.generated).toBeGreaterThanOrEqual(1);
    expect(
      wrapper.generated - before.generated + wrapper.unwrapped - before.unwrapped,
    ).toBeLessThanOrEqual(5);
  });

  it("field は「sensitive.表.列」の形だけ", async () => {
    await expect(
      store.run(scopeOf(a), async (s) => s.seal("tasks.tasks.title", "row-1", "x")),
    ).rejects.toThrow(/sensitive\.表\.列/);
  });

  it("社員の代理ログインの最中は使えない(403)", async () => {
    await expect(
      store.run({ ...scopeOf(a), support: { sessionId: "s" } }, async () => "見えた"),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("解約で鍵の行を消すと、残った暗号文(写し)はもう開けない(暗号による消去)", async () => {
    const d = await createTenantFixture(owner.db, "sens-d");
    const sealed = await store.run(scopeOf(d), async (s) => s.seal(field, "row-1", "x"));
    await deleteTenant(owner.db, d.tenantId, {
      confirmName: `sens-d-${d.tenantId.slice(-12)}`,
      supportTenantId: null,
    });
    store.forget(d.tenantId);
    // 同じ組織の ID でもう一度使うと、新しい鍵が作られる。前の暗号文は開けない
    await expect(
      store.run(scopeOf(d), async (s) => s.open(field, "row-1", sealed)),
    ).rejects.toThrow(SealedValueError);
  });
});

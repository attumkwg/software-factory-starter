import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../../src/db/client.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { runTenantShares, tenantShares } from "../../src/usage/index.ts";
import { createTenantFixture, type TenantFixture } from "../helpers/fixtures.ts";
import { createIsolatedDatabase } from "../helpers/isolated-db.ts";

// 1社あたりの原価の按分の元(docs/specs/0042-tenant-cost.md)。全社を数えるので、自分だけの DB を使う。
// 2つのお客さん(a・b)と運営(ops)。出すのは帯ごとの数だけで、組織と人の ID は出さない。

let owner: ReturnType<typeof createDb>;
let a: TenantFixture;
let b: TenantFixture;
let ops: TenantFixture;

const audit = (t: TenantFixture, kind: "user" | "system", at: string, outcome = "allowed") =>
  withTenant(owner.db, t.tenantId, (tx) =>
    tx.execute(
      sql`insert into platform.audit_events (id, tenant_id, occurred_at, actor_kind, actor_id, action, outcome)
        values (gen_random_uuid(), ${t.tenantId}, ${at}::timestamptz, ${kind}, ${t.users.admin.id}, 'task.create', ${outcome})`,
    ),
  );

beforeAll(async () => {
  const dbs = await createIsolatedDatabase(inject("adminUrl"), "shares");
  owner = createDb(dbs.ownerUrl);
  a = await createTenantFixture(owner.db, "acme");
  b = await createTenantFixture(owner.db, "globex");
  ops = await createTenantFixture(owner.db, "ops");
});
afterAll(async () => {
  await owner?.pool.end();
});

describe("tenant-shares", () => {
  it("人数・行の数・その月の人の書き込みを数え、帯ごとの合計だけを出す(運営の組織は数えない)", async () => {
    await audit(a, "user", "2026-10-03T00:00:00Z");
    await audit(a, "user", "2026-10-31T23:59:00Z");
    await audit(a, "user", "2026-11-01T00:00:00Z"); // 次の月
    await audit(a, "system", "2026-10-05T00:00:00Z"); // 仕組みの記録
    await audit(a, "user", "2026-10-06T00:00:00Z", "denied"); // 断った操作
    await audit(b, "user", "2026-10-10T00:00:00Z");
    await audit(ops, "user", "2026-10-10T00:00:00Z");

    const shares = await tenantShares(owner.db, "2026-10", { supportTenantId: ops.tenantId });
    expect(shares.tenantsTotal).toBe(2);
    expect(shares.totals.users).toBe(6); // 3人ずつ
    expect(shares.totals.writes).toBe(3); // a が2・b が1
    expect(shares.bands).toHaveLength(1);
    expect(shares.bands[0]).toMatchObject({ band: "1〜5人", tenants: 2, small: true, writes: 3 });
    expect(shares.largestPct.writes).toBe(67);
    // 行の数は、組織の行・人・計画・タスク・監査ログ(a は 5行・b は 1行)などの合計
    expect(shares.totals.rows).toBeGreaterThan(10);
  });

  it("コマンドの入口: JSON 1行と置き場の案内。ID を出さない。月が違えば止まる", async () => {
    const lines = await runTenantShares(owner.db, ["--month", "2026-10"], {
      supportTenantId: ops.tenantId,
    });
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] as string)).toMatchObject({
      mode: "tenant-shares",
      month: "2026-10",
    });
    const text = lines.join("\n");
    for (const t of [a, b, ops]) {
      expect(text).not.toContain(t.tenantId);
      for (const u of Object.values(t.users)) expect(text).not.toContain(u.id);
    }
    await expect(
      runTenantShares(owner.db, ["--month", "10/2026"], { supportTenantId: null }),
    ).rejects.toThrow("YYYY-MM");
  });
});

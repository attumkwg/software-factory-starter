import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../../src/db/client.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { DEMO_DATA, resetDemo, runDemoReset } from "../../src/demo/index.ts";
import { createTenantFixture, type TenantFixture } from "../helpers/fixtures.ts";
import { createIsolatedDatabase } from "../helpers/isolated-db.ts";

// 営業のデモ用の組織を戻す(docs/specs/0053-sales-kit.md)。デモの組織(demo)と、ほかの組織(other)。
// 戻すのはデモの組織だけで、人・監査ログは残り、ほかの組織には触れない。
// タスクの表をまとめて消して入れ直すので、自分だけの DB を使う(同じ DB だと、ほかのファイルの実行計画の確かめが揺れる)。

let owner: ReturnType<typeof createDb>;
let demo: TenantFixture;
let other: TenantFixture;

beforeAll(async () => {
  const dbs = await createIsolatedDatabase(inject("adminUrl"), "demo");
  owner = createDb(dbs.ownerUrl);
  demo = await createTenantFixture(owner.db, "demo");
  other = await createTenantFixture(owner.db, "other");
});
afterAll(async () => {
  await owner?.pool.end();
});

const count = (t: TenantFixture, table: string) =>
  withTenant(owner.db, t.tenantId, async (tx) => {
    const [schema = "", rel = ""] = table.split(".");
    const r = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(schema)}.${sql.identifier(rel)} where tenant_id = ${t.tenantId}`,
    );
    return r.rows[0]?.n ?? 0;
  });

describe("demo-reset", () => {
  it("試しは数えるだけ。本番はデモの組織の計画とタスクを消してデモのデータを入れ直し、監査ログに残す", async () => {
    const before = {
      tasks: await count(demo, "tasks.tasks"),
      users: await count(demo, "organizations.users"),
    };
    const plan = await resetDemo(owner.db, demo.tenantId, { execute: false });
    expect(plan.mode).toBe("plan");
    expect(plan.removed["tasks.tasks"]).toBe(before.tasks);
    expect(await count(demo, "tasks.tasks")).toBe(before.tasks);

    const done = await resetDemo(owner.db, demo.tenantId, { execute: true });
    expect(done.removed["tasks.tasks"]).toBe(before.tasks);
    expect(await count(demo, "projects.projects")).toBe(DEMO_DATA.length);
    expect(await count(demo, "tasks.tasks")).toBe(
      DEMO_DATA.reduce((a, p) => a + p.tasks.length, 0),
    );
    expect(await count(demo, "organizations.users")).toBe(before.users);
    const audit = await withTenant(owner.db, demo.tenantId, (tx) =>
      tx.execute<{ action: string }>(
        sql`select action from platform.audit_events where tenant_id = ${demo.tenantId} and action = 'demo.reset'`,
      ),
    );
    expect(audit.rows).toHaveLength(1);
    // 2回目も同じ形に戻る
    await resetDemo(owner.db, demo.tenantId, { execute: true });
    expect(await count(demo, "projects.projects")).toBe(DEMO_DATA.length);
    // ほかの組織はそのまま
    expect(await count(other, "projects.projects")).toBe(1);
    expect(await count(other, "tasks.tasks")).toBe(1);
  });

  it("コマンドの入口: stg と DEMO_TENANT_ID が要る。出す行に組織と人の ID は無い。無い組織なら止まる", async () => {
    const env = { APP_ENV: "stg", DEMO_TENANT_ID: demo.tenantId };
    const lines = await runDemoReset(owner.db, [], env);
    expect(lines).toHaveLength(2);
    const text = lines.join("\n");
    expect(text).not.toContain(demo.tenantId);
    for (const u of Object.values(demo.users)) expect(text).not.toContain(u.id);
    await expect(runDemoReset(owner.db, [], { ...env, APP_ENV: "prod" })).rejects.toThrow("stg");
    await expect(
      runDemoReset(owner.db, ["--execute"], {
        ...env,
        DEMO_TENANT_ID: "0199a000-0000-7000-8000-0000000dead0",
      }),
    ).rejects.toThrow("先に create-tenant");
  });
});

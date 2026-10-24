import type { CreatedSupportGrant, FeatureFlagDefinition, FeatureFlagName } from "@app/shared";
import { sql } from "drizzle-orm";
import type { Context } from "hono";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../../src/db/client.ts";
import { withTenant } from "../../src/db/tenant.ts";
import type { AppEnv } from "../../src/env.ts";
import { ApiError } from "../../src/errors.ts";
import {
  isFeatureEnabled,
  requireFeature,
  setFeatureFlag,
  showFeatureFlags,
} from "../../src/feature-flags/index.ts";
import {
  call,
  createTenantFixture,
  createTestApp,
  login,
  type TenantFixture,
} from "../helpers/fixtures.ts";

// 組織ごとの機能フラグ(docs/specs/0012-feature-flags-and-usage.md)。キットには機能が無いので、定義を差し替えたアプリで確かめる。
// 2つのお客さん(a・b)と運営(ops。代理ログイン用)。

const DEFS: FeatureFlagDefinition[] = [
  { name: "picked", bet: "B-0001", description: "選んだ組織だけ", state: "rollout" },
  { name: "everyone", bet: "B-0001", description: "全部", state: "on" },
  { name: "stopped", bet: "B-0001", description: "全部で止める", state: "off" },
];

const owner = createDb(inject("ownerUrl"));
const appDb = createDb(inject("appUrl"));
let a: TenantFixture;
let b: TenantFixture;
let ops: TenantFixture;
let app: ReturnType<typeof createTestApp>["app"];
let pool: ReturnType<typeof createTestApp>["pool"];

beforeAll(async () => {
  a = await createTenantFixture(owner.db, "acme");
  b = await createTenantFixture(owner.db, "globex");
  ops = await createTenantFixture(owner.db, "ops");
  ({ app, pool } = createTestApp(
    inject("appUrl"),
    { SUPPORT_TENANT_ID: ops.tenantId },
    { featureFlags: DEFS },
  ));
  // a にだけ picked を入れる。stopped は入れても効かない(off)ので、表に直接足しておく
  await setFeatureFlag(owner.db, a.tenantId, "picked", true, { defs: DEFS, execute: true });
  await withTenant(owner.db, a.tenantId, (tx) =>
    tx.execute(
      sql`insert into platform.feature_flags (id, tenant_id, flag) values (gen_random_uuid(), ${a.tenantId}, 'stopped')`,
    ),
  );
});
afterAll(async () => {
  await owner.pool.end();
  await appDb.pool.end();
  await pool.end();
});

const featuresOf = async (cookie: string) => {
  const res = await call(app, "GET", "/api/me", { cookie });
  expect(res.status).toBe(200);
  return ((await res.json()) as { features?: string[] }).features;
};

async function auditRows(tenantId: string) {
  const r = await withTenant(owner.db, tenantId, (tx) =>
    tx.execute<{ action: string; actor_kind: string; actor_id: string | null; details: unknown }>(
      sql`select action, actor_kind, actor_id, details from platform.audit_events
        where tenant_id = ${tenantId} and action like 'feature_flag.%' order by id`,
    ),
  );
  return r.rows;
}

describe("自分(GET /api/me)", () => {
  it("入れた組織には rollout と on が出る。off は入れてあっても出ない(定義の順)", async () => {
    for (const role of ["admin", "member", "viewer"] as const) {
      expect(await featuresOf(await login(app, a.users[role].email))).toEqual([
        "picked",
        "everyone",
      ]);
    }
  });

  it("他社には、ほかの組織で入れた機能は出ない(on だけ)", async () => {
    expect(await featuresOf(await login(app, b.users.admin.email))).toEqual(["everyone"]);
  });

  it("定義が無ければ空の一覧(キットの既定)", async () => {
    const plain = createTestApp(inject("appUrl"));
    try {
      const res = await call(plain.app, "GET", "/api/me", {
        cookie: await login(plain.app, a.users.admin.email),
      });
      expect(((await res.json()) as { features?: string[] }).features).toEqual([]);
    } finally {
      await plain.pool.end();
    }
  });

  it("代理の社員には、見ている組織と同じ一覧が出る", async () => {
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
    expect(await featuresOf(staff)).toEqual(["picked", "everyone"]);
  });
});

describe("守り(機能の API)", () => {
  /** 関所を通った後のハンドラーと同じ文脈(組織の文脈つきの tx・行為者・定義) */
  const handlerContext = (tx: unknown, tenantId: string) =>
    ({
      get: (key: string) =>
        ({ tx, actor: { tenantId, userId: a.users.admin.id, role: "admin" }, featureFlags: DEFS })[
          key
        ],
    }) as unknown as Context<AppEnv>;

  it("入っていれば通り、入っていなければ 404(アプリの接続・RLS つき)", async () => {
    const picked = "picked" as FeatureFlagName;
    await withTenant(appDb.db, a.tenantId, (tx) =>
      requireFeature(handlerContext(tx, a.tenantId), picked),
    );
    const denied = await withTenant(appDb.db, b.tenantId, (tx) =>
      requireFeature(handlerContext(tx, b.tenantId), picked).then(
        () => null,
        (e: unknown) => e,
      ),
    );
    expect(denied).toBeInstanceOf(ApiError);
    expect((denied as ApiError).status).toBe(404);
  });

  it("on は全部・off と定義に無い名前はどこでも入っていない", async () => {
    const check = (tenantId: string, name: string) =>
      withTenant(appDb.db, tenantId, (tx) => isFeatureEnabled(tx, tenantId, DEFS, name));
    expect(await check(b.tenantId, "everyone")).toBe(true);
    expect(await check(a.tenantId, "stopped")).toBe(false);
    expect(await check(a.tenantId, "unknown")).toBe(false);
  });

  it("他社の組織の文脈では、ほかの組織の行は読めない(RLS)", async () => {
    // b の文脈で a の tenant_id を指しても、行は見えない
    expect(
      await withTenant(appDb.db, b.tenantId, (tx) =>
        isFeatureEnabled(tx, a.tenantId, DEFS, "picked"),
      ),
    ).toBe(false);
  });

  it("アプリの接続は表を読むだけ(足せない)", async () => {
    const tried = await withTenant(appDb.db, b.tenantId, (tx) =>
      tx
        .execute(
          sql`insert into platform.feature_flags (id, tenant_id, flag) values (gen_random_uuid(), ${b.tenantId}, 'picked')`,
        )
        .then(
          () => "inserted",
          (e: { cause?: { code?: string } }) => e.cause?.code,
        ),
    );
    expect(tried).toBe("42501"); // insufficient_privilege
  });
});

describe("運営のコマンド", () => {
  it("一覧は定義の順に、状態と入っているか", async () => {
    expect(await showFeatureFlags(owner.db, a.tenantId, DEFS)).toEqual([
      { name: "picked", state: "rollout", enabled: true },
      { name: "everyone", state: "on", enabled: true },
      { name: "stopped", state: "off", enabled: false },
    ]);
  });

  it("試しは変えない。--execute で入れる・切る。そのたびに組織の監査ログに仕組みとして残る", async () => {
    const opts = { defs: DEFS, execute: false };
    expect(await setFeatureFlag(owner.db, b.tenantId, "picked", true, opts)).toEqual({
      flag: "picked",
      enabled: false,
      next: true,
      changed: true,
    });
    expect(await featuresOf(await login(app, b.users.admin.email))).toEqual(["everyone"]);
    expect(await auditRows(b.tenantId)).toEqual([]);

    const run = { defs: DEFS, execute: true };
    await setFeatureFlag(owner.db, b.tenantId, "picked", true, run);
    expect(await featuresOf(await login(app, b.users.admin.email))).toEqual(["picked", "everyone"]);
    // 2回目は何もしない(行も記録も増えない)
    expect((await setFeatureFlag(owner.db, b.tenantId, "picked", true, run)).changed).toBe(false);
    await setFeatureFlag(owner.db, b.tenantId, "picked", false, run);
    expect(await featuresOf(await login(app, b.users.admin.email))).toEqual(["everyone"]);

    const rows = await auditRows(b.tenantId);
    expect(rows).toEqual([
      {
        action: "feature_flag.enable",
        actor_kind: "system",
        actor_id: null,
        details: { flag: "picked" },
      },
      {
        action: "feature_flag.disable",
        actor_kind: "system",
        actor_id: null,
        details: { flag: "picked" },
      },
    ]);
    // a の記録は a の組織にだけ(b には a の分が混ざらない)
    expect((await auditRows(a.tenantId)).map((r) => r.action)).toEqual(["feature_flag.enable"]);
  });

  it("定義に無い名前・rollout ではない機能・無い組織は、何も変えずに止まる", async () => {
    const run = { defs: DEFS, execute: true };
    await expect(setFeatureFlag(owner.db, b.tenantId, "unknown", true, run)).rejects.toThrow(
      "定義に無い機能です",
    );
    await expect(setFeatureFlag(owner.db, b.tenantId, "everyone", false, run)).rejects.toThrow(
      "組織ごとに変えても効きません",
    );
    const missing = "00000000-0000-7000-8000-000000000000";
    await expect(setFeatureFlag(owner.db, missing, "picked", true, run)).rejects.toThrow(
      "組織がありません",
    );
    await expect(showFeatureFlags(owner.db, missing, DEFS)).rejects.toThrow("組織がありません");
  });
});

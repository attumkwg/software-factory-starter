import type { AuditEventPage, CreatedSupportGrant, IpAllowlist, PlanDefinition } from "@app/shared";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../../src/db/client.ts";
import { setPlan } from "../../src/plans/index.ts";
import {
  call,
  createTenantFixture,
  createTestApp,
  login,
  type TenantFixture,
} from "../helpers/fixtures.ts";

// 大きなお客さん向けの守りの段1a(docs/specs/0056-sso-scim-ip-audit-export.md)の受け入れ条件のうち、
// 組織に入れる IP の範囲(関所とログイン)。ほかの組織(b)と運営(ops。代理ログインは対象外)と比べる。
// キットの既定のプランには ip-allowlist が無いので、入れたプランを差し替えたアプリで確かめる。

const PLANS: PlanDefinition[] = [
  { id: "standard", label: "スタンダード", features: [] },
  { id: "enterprise", label: "エンタープライズ", features: ["ip-allowlist"] },
];
const PRICE_LISTS = [{ id: "2026-10", effectiveFrom: "2026-10-01", description: "最初" }];

const owner = createDb(inject("ownerUrl"));
let b: TenantFixture;
let ops: TenantFixture;
let app: ReturnType<typeof createTestApp>["app"];
let pool: ReturnType<typeof createTestApp>["pool"];

const OFFICE = "203.0.113.10";
const HOME = "198.51.100.7";
// ALB が右端に足した相手の IP。左は呼ぶ側が好きに書ける(信じない)
const from = (ip: string) => ({ "x-forwarded-for": `10.0.0.1, ${ip}` });

beforeAll(async () => {
  b = await createTenantFixture(owner.db, "globex");
  ops = await createTenantFixture(owner.db, "ops");
  ({ app, pool } = createTestApp(
    inject("appUrl"),
    { SUPPORT_TENANT_ID: ops.tenantId },
    { plans: PLANS },
  ));
});
afterAll(async () => {
  await owner.pool.end();
  await pool.end();
});

const cookieOf = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? "";

async function loginFrom(email: string, ip: string) {
  const res = await app.request("/api/auth/dev-login", {
    method: "POST",
    headers: { "content-type": "application/json", ...from(ip) },
    body: JSON.stringify({ email }),
  });
  return { res, cookie: cookieOf(res) };
}

const putAllowlist = (cookie: string, cidrs: string[], ip: string) =>
  call(app, "PUT", "/api/organization/ip-allowlist", {
    cookie,
    body: { cidrs },
    headers: from(ip),
  });

async function auditActions(cookie: string, ip: string) {
  const res = await call(app, "GET", "/api/audit-events?limit=100", { cookie, headers: from(ip) });
  expect(res.status).toBe(200);
  return ((await res.json()) as AuditEventPage).events.map((e) => ({
    action: e.action,
    outcome: e.outcome,
  }));
}

const defs = { plans: PLANS, priceLists: PRICE_LISTS, execute: true };

async function enterpriseTenant(label: string) {
  const t = await createTenantFixture(owner.db, label);
  await setPlan(owner.db, t.tenantId, { plan: "enterprise", seats: null }, defs);
  return t;
}

describe("組織に入れる IP の範囲", () => {
  it("いまの IP を含まない一覧は保存できない(409)。形の違う範囲は 400・21 個は 400", async () => {
    const t = await enterpriseTenant("ip-guard");
    const admin = await login(app, t.users.admin.email);
    const out = await putAllowlist(admin, ["203.0.113.0/24"], HOME);
    expect(out.status).toBe(409);
    expect(((await out.json()) as { error: { code: string } }).error.code).toBe(
      "allowlist_excludes_you",
    );
    expect((await putAllowlist(admin, ["203.0.113.0/33"], OFFICE)).status).toBe(400);
    const many = Array.from({ length: 21 }, (_, i) => `10.${i}.0.0/16`);
    expect((await putAllowlist(admin, many, OFFICE)).status).toBe(400);
  });

  it("範囲を決めると、外の IP からは関所もログインも 403 ip_not_allowed。中からは入れる。空にすると戻る", async () => {
    const t = await enterpriseTenant("ip-on");
    const admin = (await loginFrom(t.users.admin.email, OFFICE)).cookie;
    const member = (await loginFrom(t.users.member.email, HOME)).cookie;

    const put = await putAllowlist(admin, ["203.0.113.0/24", "2001:db8::/32"], OFFICE);
    expect(put.status).toBe(200);
    expect((await put.json()) as IpAllowlist).toEqual({
      cidrs: ["203.0.113.0/24", "2001:db8::/32"],
      yourIp: OFFICE,
    });

    // 外からの既にあるセッション → 次のリクエストから 403
    const outside = await call(app, "GET", "/api/me", { cookie: member, headers: from(HOME) });
    expect(outside.status).toBe(403);
    expect(((await outside.json()) as { error: { code: string } }).error.code).toBe(
      "ip_not_allowed",
    );
    // 左に書いた IP は信じない
    const spoofed = await call(app, "GET", "/api/me", {
      cookie: member,
      headers: { "x-forwarded-for": `${OFFICE}, ${HOME}` },
    });
    expect(spoofed.status).toBe(403);
    // ヘッダーが無い(分からない)なら入れない
    expect((await call(app, "GET", "/api/me", { cookie: member })).status).toBe(403);
    // 中からなら入れる(IPv6 も)
    expect(
      (await call(app, "GET", "/api/me", { cookie: member, headers: from(OFFICE) })).status,
    ).toBe(200);
    expect(
      (await call(app, "GET", "/api/me", { cookie: member, headers: from("2001:db8::1") })).status,
    ).toBe(200);

    // 空にすると制限しない
    expect((await putAllowlist(admin, [], OFFICE)).status).toBe(200);
    expect(
      (await call(app, "GET", "/api/me", { cookie: member, headers: from(HOME) })).status,
    ).toBe(200);
  });

  it("外の IP からのログインはセッションを出さない。拒否は監査ログに残る", async () => {
    const t = await enterpriseTenant("ip-login");
    const admin = (await loginFrom(t.users.admin.email, OFFICE)).cookie;
    expect((await putAllowlist(admin, ["203.0.113.0/24"], OFFICE)).status).toBe(200);
    const refused = await loginFrom(t.users.viewer.email, HOME);
    expect(refused.res.status).toBe(403);
    expect(refused.res.headers.get("set-cookie")).toBeNull();
    expect((await loginFrom(t.users.viewer.email, OFFICE)).res.status).toBe(200);
    expect(await auditActions(admin, OFFICE)).toEqual(
      expect.arrayContaining([
        { action: "ip_allowlist.update", outcome: "allowed" },
        { action: "auth.login", outcome: "denied" },
      ]),
    );
  });
});

describe("範囲が効く相手", () => {
  it("ほかの組織の範囲は効かない", async () => {
    const t = await enterpriseTenant("ip-a");
    const admin = await login(app, t.users.admin.email);
    expect((await putAllowlist(admin, ["203.0.113.0/24"], OFFICE)).status).toBe(200);
    const bMember = await login(app, b.users.member.email);
    expect(
      (await call(app, "GET", "/api/me", { cookie: bMember, headers: from(HOME) })).status,
    ).toBe(200);
  });

  it("プランから外れたら、残った範囲は効かない(設定の API も 404)", async () => {
    const t = await enterpriseTenant("ip-downgrade");
    const admin = await login(app, t.users.admin.email);
    expect((await putAllowlist(admin, ["203.0.113.0/24"], OFFICE)).status).toBe(200);
    await setPlan(owner.db, t.tenantId, { plan: "standard", seats: null }, defs);
    expect((await call(app, "GET", "/api/me", { cookie: admin, headers: from(HOME) })).status).toBe(
      200,
    );
    expect(
      (await call(app, "GET", "/api/organization/ip-allowlist", { cookie: admin })).status,
    ).toBe(404);
  });

  it("代理ログインの社員は、お客さんの IP の制限を受けない(U-4)", async () => {
    const t = await enterpriseTenant("ip-support");
    const admin = (await loginFrom(t.users.admin.email, OFFICE)).cookie;
    expect((await putAllowlist(admin, ["203.0.113.0/24"], OFFICE)).status).toBe(200);
    const g = await call(app, "POST", "/api/support-grants", {
      cookie: admin,
      body: { hours: 1 },
      headers: from(OFFICE),
    });
    expect(g.status).toBe(201);
    const { code } = (await g.json()) as CreatedSupportGrant;
    const staff = await login(app, ops.users.admin.email);
    const entered = await call(app, "POST", "/api/support/sessions", {
      cookie: staff,
      body: { code },
      headers: from(HOME),
    });
    expect(entered.status).toBe(201);
    const res = await call(app, "GET", "/api/projects", {
      cookie: cookieOf(entered),
      headers: from(HOME),
    });
    expect(res.status).toBe(200);
  });
});

describe("読むヘッダーを設定で変える(CloudFront を前に置いたとき。U-9)", () => {
  it("CLIENT_IP_HEADER を CloudFront-Viewer-Address にすると、X-Forwarded-For は見ない", async () => {
    const cf = createTestApp(
      inject("appUrl"),
      { CLIENT_IP_HEADER: "CloudFront-Viewer-Address" },
      { plans: PLANS },
    );
    try {
      const t = await enterpriseTenant("ip-cloudfront");
      const viewer = (ip: string) => ({ "cloudfront-viewer-address": `${ip}:46532` });
      const res = await cf.app.request("/api/auth/dev-login", {
        method: "POST",
        headers: { "content-type": "application/json", ...viewer(OFFICE) },
        body: JSON.stringify({ email: t.users.admin.email }),
      });
      const admin = cookieOf(res);
      const put = await call(cf.app, "PUT", "/api/organization/ip-allowlist", {
        cookie: admin,
        body: { cidrs: ["203.0.113.0/24"] },
        headers: viewer(OFFICE),
      });
      expect((await put.json()) as IpAllowlist).toMatchObject({ yourIp: OFFICE });
      // X-Forwarded-For に会社の IP を書いても、読むのは CloudFront の値
      const spoofed = await call(cf.app, "GET", "/api/me", {
        cookie: admin,
        headers: { ...viewer(HOME), ...from(OFFICE) },
      });
      expect(spoofed.status).toBe(403);
      expect(
        (await call(cf.app, "GET", "/api/me", { cookie: admin, headers: viewer(OFFICE) })).status,
      ).toBe(200);
    } finally {
      await cf.pool.end();
    }
  });
});

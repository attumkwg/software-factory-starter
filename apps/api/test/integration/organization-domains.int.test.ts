import type {
  AuditEventPage,
  OrganizationDomain,
  OrganizationDomainList,
  OrganizationMemberPage,
  PlanDefinition,
} from "@app/shared";
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
// 会社のドメインの確認と、人の一覧と強制ログアウト。2社(a・b)で。IP の範囲は ip-allowlist.int.test.ts。
// キットの既定のプランには sso が無いので、入れたプランを差し替えたアプリで確かめる。

const PLANS: PlanDefinition[] = [
  { id: "standard", label: "スタンダード", features: [] },
  { id: "enterprise", label: "エンタープライズ", features: ["sso"] },
];
const PRICE_LISTS = [{ id: "2026-10", effectiveFrom: "2026-10-01", description: "最初" }];

// DNS の代わり(名前 → TXT の答え)。テストごとに置く
const dns = new Map<string, string[][]>();
const resolveTxt = async (name: string) => {
  const records = dns.get(name);
  if (!records) throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
  return records;
};

const owner = createDb(inject("ownerUrl"));
let a: TenantFixture;
let b: TenantFixture;
let app: ReturnType<typeof createTestApp>["app"];
let pool: ReturnType<typeof createTestApp>["pool"];

beforeAll(async () => {
  a = await createTenantFixture(owner.db, "acme");
  b = await createTenantFixture(owner.db, "globex");
  ({ app, pool } = createTestApp(inject("appUrl"), {}, { plans: PLANS, resolveTxt }));
  for (const t of [a, b]) {
    await setPlan(
      owner.db,
      t.tenantId,
      { plan: "enterprise", seats: null },
      { plans: PLANS, priceLists: PRICE_LISTS, execute: true },
    );
  }
});
afterAll(async () => {
  await owner.pool.end();
  await pool.end();
});

async function addDomain(cookie: string, domain: string) {
  const res = await call(app, "POST", "/api/organization/domains", { cookie, body: { domain } });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as OrganizationDomain;
}

const verify = (cookie: string, id: string) =>
  call(app, "POST", `/api/organization/domains/${id}/verify`, { cookie });

async function auditActions(cookie: string) {
  const res = await call(app, "GET", "/api/audit-events?limit=100", { cookie });
  expect(res.status).toBe(200);
  return ((await res.json()) as AuditEventPage).events.map((e) => ({
    action: e.action,
    outcome: e.outcome,
  }));
}

describe("会社のドメイン", () => {
  it("登録すると DNS に置く名前と文字が出る。DNS に見えるまでは確かめられない", async () => {
    const admin = await login(app, a.users.admin.email);
    const d = await addDomain(admin, "acme-corp.example");
    expect(d.verifiedAt).toBeNull();
    expect(d.verifyRecord.name).toBe("_sfs-verify.acme-corp.example");
    expect(d.verifyRecord.value).toMatch(/^sfs-verify=/);

    // 何も置いていない・違う文字
    expect((await verify(admin, d.id)).status).toBe(409);
    dns.set(d.verifyRecord.name, [["sfs-verify=wrong"]]);
    const wrong = await verify(admin, d.id);
    expect(wrong.status).toBe(409);
    expect(((await wrong.json()) as { error: { code: string } }).error.code).toBe(
      "domain_not_verified",
    );

    // 長い TXT は分けて届くことがある(つないで比べる)
    const value = d.verifyRecord.value;
    dns.set(d.verifyRecord.name, [["other"], [value.slice(0, 10), value.slice(10)]]);
    const ok = await verify(admin, d.id);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as OrganizationDomain).verifiedAt).not.toBeNull();

    const list = await call(app, "GET", "/api/organization/domains", { cookie: admin });
    const { domains } = (await list.json()) as OrganizationDomainList;
    expect(domains.map((x) => x.domain)).toContain("acme-corp.example");
    expect(await auditActions(admin)).toEqual(
      expect.arrayContaining([
        { action: "domain.create", outcome: "allowed" },
        { action: "domain.verify", outcome: "allowed" },
      ]),
    );
  });

  it("同じ組織に同じドメインは2つ登録できない(409)", async () => {
    const admin = await login(app, a.users.admin.email);
    await addDomain(admin, "dup.example");
    const again = await call(app, "POST", "/api/organization/domains", {
      cookie: admin,
      body: { domain: "dup.example" },
    });
    expect(again.status).toBe(409);
  });

  it("確かめたドメインは全体で1つの組織だけ。後から確かめた組織は 409 domain_taken", async () => {
    const aAdmin = await login(app, a.users.admin.email);
    const bAdmin = await login(app, b.users.admin.email);
    const mine = await addDomain(aAdmin, "shared.example");
    const theirs = await addDomain(bAdmin, "shared.example");
    dns.set(mine.verifyRecord.name, [[mine.verifyRecord.value], [theirs.verifyRecord.value]]);
    expect((await verify(aAdmin, mine.id)).status).toBe(200);
    const taken = await verify(bAdmin, theirs.id);
    expect(taken.status).toBe(409);
    expect(((await taken.json()) as { error: { code: string } }).error.code).toBe("domain_taken");
  });

  it("他社のドメインは見えない・確かめられない・消せない(404)", async () => {
    const aAdmin = await login(app, a.users.admin.email);
    const bAdmin = await login(app, b.users.admin.email);
    const d = await addDomain(aAdmin, "private.example");
    dns.set(d.verifyRecord.name, [[d.verifyRecord.value]]);
    expect((await verify(bAdmin, d.id)).status).toBe(404);
    const del = await call(app, "DELETE", `/api/organization/domains/${d.id}`, { cookie: bAdmin });
    expect(del.status).toBe(404);
    const list = await call(app, "GET", "/api/organization/domains", { cookie: bAdmin });
    const { domains } = (await list.json()) as OrganizationDomainList;
    expect(domains.map((x) => x.id)).not.toContain(d.id);

    expect(
      (await call(app, "DELETE", `/api/organization/domains/${d.id}`, { cookie: aAdmin })).status,
    ).toBe(204);
  });

  it("プランに sso が無い組織では 404", async () => {
    const t = await createTenantFixture(owner.db, "no-sso");
    const admin = await login(app, t.users.admin.email);
    expect((await call(app, "GET", "/api/organization/domains", { cookie: admin })).status).toBe(
      404,
    );
  });
});

describe("人の一覧と強制ログアウト", () => {
  it("管理者が切ると、その人の今のセッションは次のリクエストから 401。ログインし直せば入れる", async () => {
    const t = await createTenantFixture(owner.db, "signout");
    const admin = await login(app, t.users.admin.email);
    const member = await login(app, t.users.member.email);
    expect((await call(app, "GET", "/api/me", { cookie: member })).status).toBe(200);

    const list = await call(app, "GET", "/api/organization/members?limit=2", { cookie: admin });
    const page = (await list.json()) as OrganizationMemberPage;
    expect(page.members).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();

    // ログインした時刻と同じ秒に切ったことにならないよう、少し待つ
    await new Promise((r) => setTimeout(r, 1100));
    const res = await call(app, "POST", `/api/organization/members/${t.users.member.id}/sign-out`, {
      cookie: admin,
    });
    expect(res.status).toBe(204);
    expect((await call(app, "GET", "/api/me", { cookie: member })).status).toBe(401);
    const again = await login(app, t.users.member.email);
    expect((await call(app, "GET", "/api/me", { cookie: again })).status).toBe(200);
    expect(await auditActions(admin)).toEqual(
      expect.arrayContaining([{ action: "member.sign_out", outcome: "allowed" }]),
    );
  });

  it("他社の人は切れない(404)。一覧にも出ない", async () => {
    const aAdmin = await login(app, a.users.admin.email);
    const res = await call(app, "POST", `/api/organization/members/${b.users.member.id}/sign-out`, {
      cookie: aAdmin,
    });
    expect(res.status).toBe(404);
    const list = await call(app, "GET", "/api/organization/members?limit=100", { cookie: aAdmin });
    const ids = ((await list.json()) as OrganizationMemberPage).members.map((m) => m.id);
    expect(ids).toContain(a.users.member.id);
    expect(ids).not.toContain(b.users.member.id);
  });
});

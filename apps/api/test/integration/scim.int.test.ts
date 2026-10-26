import type { AuditEventPage, CreatedScimToken, PlanDefinition, ScimTokenList } from "@app/shared";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../../src/db/client.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { domains, users } from "../../src/domains/organizations/schema.ts";
import { setPlan } from "../../src/plans/index.ts";
import {
  call,
  createTenantFixture,
  createTestApp,
  login,
  type TenantFixture,
} from "../helpers/fixtures.ts";

// 大きなお客さん向けの守りの段2: SCIM(docs/specs/0056-sso-scim-ip-audit-export.md・設計書 0056 の 3・6)。
// 鍵で組織が決まる・確かめたドメインの人だけ作れる・止めた人は次のリクエストから入れない・他社の人は 404・
// 操作は「SCIM が」として監査ログに残る。2社(a・b)と、プランに scim が無い組織(c)で確かめる。

const PLANS: PlanDefinition[] = [
  { id: "standard", label: "スタンダード", features: [] },
  { id: "enterprise", label: "エンタープライズ", features: ["sso", "scim"] },
];
const PRICE_LISTS = [{ id: "2026-10", effectiveFrom: "2026-10-01", description: "最初" }];

const owner = createDb(inject("ownerUrl"));
let app: ReturnType<typeof createTestApp>["app"];
let pool: ReturnType<typeof createTestApp>["pool"];

beforeAll(() => {
  ({ app, pool } = createTestApp(inject("appUrl"), {}, { plans: PLANS }));
});
afterAll(async () => {
  await owner.pool.end();
  await pool.end();
});

type Org = TenantFixture & { domain: string; admin: string; token: string };

/** プランに scim を入れ、fixture のメールのドメインを確かめ済みにし、管理者が鍵を作った組織 */
async function scimOrg(label: string, plan = "enterprise"): Promise<Org> {
  const unique = `${label}-${uuidv7().slice(-8)}`;
  const f = await createTenantFixture(owner.db, unique);
  const domain = `${unique}.test`;
  await setPlan(
    owner.db,
    f.tenantId,
    { plan, seats: null },
    { plans: PLANS, priceLists: PRICE_LISTS, execute: true },
  );
  await withTenant(owner.db, f.tenantId, (tx) =>
    tx.insert(domains).values({
      id: uuidv7(),
      tenantId: f.tenantId,
      domain,
      verifyToken: "t",
      verifiedAt: new Date(),
      createdBy: f.users.admin.id,
    }),
  );
  const admin = await login(app, f.users.admin.email);
  let token = "";
  if (plan === "enterprise") {
    const res = await call(app, "POST", "/api/organization/scim-tokens", { cookie: admin });
    expect(res.status).toBe(201);
    token = ((await res.json()) as CreatedScimToken).token;
  }
  return { ...f, domain, admin, token };
}

/** 情シスの道具のように呼ぶ(Cookie も Origin も無し・鍵だけ) */
function scim(method: string, path: string, token: string | null, body?: unknown) {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/scim+json";
  return app.request(`/api/scim/v2${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

type ScimUser = { id: string; userName: string; displayName: string; active: boolean };
type ScimList = { totalResults: number; Resources: ScimUser[] };

async function createUser(org: Org, local: string, extra: Record<string, unknown> = {}) {
  const res = await scim("POST", "/Users", org.token, {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    userName: `${local}@${org.domain}`,
    name: { familyName: "山田", givenName: local },
    externalId: `ext-${local}`,
    ...extra,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  expect(res.headers.get("content-type")).toContain("application/scim+json");
  return (await res.json()) as ScimUser;
}

async function scimActions(org: Org) {
  const res = await call(app, "GET", "/api/audit-events?limit=100", { cookie: org.admin });
  expect(res.status).toBe(200);
  return ((await res.json()) as AuditEventPage).events
    .filter((e) => e.actor.kind === "scim")
    .map((e) => ({ action: e.action, target: e.target?.id, details: e.details }));
}

describe("SCIM の鍵(管理者)", () => {
  it("鍵は作ったときだけ返り、一覧には出ない。2つまで(409)。取り消すと 401", async () => {
    const a = await scimOrg("scim-key");
    const list = await call(app, "GET", "/api/organization/scim-tokens", { cookie: a.admin });
    const body = (await list.json()) as ScimTokenList;
    expect(body.basePath).toBe("/api/scim/v2");
    expect(body.tokens).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain(a.token);

    const second = await call(app, "POST", "/api/organization/scim-tokens", { cookie: a.admin });
    expect(second.status).toBe(201);
    const third = await call(app, "POST", "/api/organization/scim-tokens", { cookie: a.admin });
    expect(third.status).toBe(409);
    expect(((await third.json()) as { error: { code: string } }).error.code).toBe(
      "too_many_scim_tokens",
    );

    expect((await scim("GET", "/Users", a.token)).status).toBe(200);
    const id = body.tokens[0]?.id ?? "";
    const revoked = await call(app, "DELETE", `/api/organization/scim-tokens/${id}`, {
      cookie: a.admin,
    });
    expect(revoked.status).toBe(204);
    const after = await scim("GET", "/Users", a.token);
    expect(after.status).toBe(401);
    expect(((await after.json()) as { schemas: string[] }).schemas).toEqual([
      "urn:ietf:params:scim:api:messages:2.0:Error",
    ]);
  });

  it("メンバーは鍵を作れない(403)。他社の鍵は取り消せない(404)", async () => {
    const a = await scimOrg("scim-auth-a");
    const b = await scimOrg("scim-auth-b");
    const member = await login(app, a.users.member.email);
    expect(
      (await call(app, "POST", "/api/organization/scim-tokens", { cookie: member })).status,
    ).toBe(403);
    const bList = (await (
      await call(app, "GET", "/api/organization/scim-tokens", { cookie: b.admin })
    ).json()) as ScimTokenList;
    const bTokenId = bList.tokens[0]?.id ?? "";
    const res = await call(app, "DELETE", `/api/organization/scim-tokens/${bTokenId}`, {
      cookie: a.admin,
    });
    expect(res.status).toBe(404);
    expect((await scim("GET", "/Users", b.token)).status).toBe(200);
  });

  it("鍵が無い・違う形は 401。プランに scim が無い組織の鍵の API は 404", async () => {
    expect((await scim("GET", "/Users", null)).status).toBe(401);
    expect((await scim("GET", "/Users", "sfs_scim_nope")).status).toBe(401);
    const c = await scimOrg("scim-noplan", "standard");
    expect(
      (await call(app, "GET", "/api/organization/scim-tokens", { cookie: c.admin })).status,
    ).toBe(404);
  });
});

describe("SCIM の Users(情シスの道具)", () => {
  it("確かめたドメインの人を作れる(ロールは member・名前は姓 名)。ほかのドメインは 400・同じメールは 409", async () => {
    const a = await scimOrg("scim-create");
    const u = await createUser(a, "taro");
    expect(u.userName).toBe(`taro@${a.domain}`);
    expect(u.displayName).toBe("山田 taro");
    expect(u.active).toBe(true);

    // 作った人はログインできる(招待なしで、その組織のメンバー)
    const cookie = await login(app, `taro@${a.domain}`);
    const me = await call(app, "GET", "/api/me", { cookie });
    expect(((await me.json()) as { role: string }).role).toBe("member");

    const outside = await scim("POST", "/Users", a.token, { userName: "x@outside.test" });
    expect(outside.status).toBe(400);
    expect(((await outside.json()) as { scimType: string }).scimType).toBe("invalidValue");

    const dup = await scim("POST", "/Users", a.token, { userName: `TARO@${a.domain}` });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { scimType: string }).scimType).toBe("uniqueness");
  });

  it("一覧は確かめたドメインの人だけ。userName eq・externalId eq で絞れる。知らない式は 400", async () => {
    const a = await scimOrg("scim-list");
    await createUser(a, "hanako");
    const all = (await (await scim("GET", "/Users", a.token)).json()) as ScimList;
    // fixture の3人+hanako(どれも確かめたドメイン)。他社の人は出ない
    expect(all.totalResults).toBe(4);

    const byName = (await (
      await scim(
        "GET",
        `/Users?filter=${encodeURIComponent(`userName eq "hanako@${a.domain}"`)}`,
        a.token,
      )
    ).json()) as ScimList;
    expect(byName.Resources.map((r) => r.userName)).toEqual([`hanako@${a.domain}`]);

    const byExt = (await (
      await scim(
        "GET",
        `/Users?filter=${encodeURIComponent('externalId eq "ext-hanako"')}`,
        a.token,
      )
    ).json()) as ScimList;
    expect(byExt.totalResults).toBe(1);

    const page = (await (
      await scim("GET", "/Users?startIndex=2&count=2", a.token)
    ).json()) as ScimList;
    expect(page.Resources).toHaveLength(2);

    const bad = await scim("GET", `/Users?filter=${encodeURIComponent('title co "x"')}`, a.token);
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { scimType: string }).scimType).toBe("invalidFilter");
  });
});

describe("SCIM で止める・直す", () => {
  it("止めた人は、止める前のセッションでも次のリクエストから 401・ログインもできない。戻すと入れる", async () => {
    const a = await scimOrg("scim-disable");
    const u = await createUser(a, "jiro");
    const cookie = await login(app, `jiro@${a.domain}`);
    expect((await call(app, "GET", "/api/me", { cookie })).status).toBe(200);

    // Entra ID は真偽を文字で送る
    const off = await scim("PATCH", `/Users/${u.id}`, a.token, {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "Replace", path: "active", value: "False" }],
    });
    expect(off.status).toBe(200);
    expect(((await off.json()) as ScimUser).active).toBe(false);
    expect((await call(app, "GET", "/api/me", { cookie })).status).toBe(401);
    await expect(login(app, `jiro@${a.domain}`)).rejects.toThrow();

    // 管理者の一覧には「止めた」が出る
    const members = await call(app, "GET", "/api/organization/members?limit=50", {
      cookie: a.admin,
    });
    const listed = (
      (await members.json()) as { members: { id: string; disabledAt: string | null }[] }
    ).members.find((m) => m.id === u.id);
    expect(listed?.disabledAt).not.toBeNull();

    const on = await scim("PATCH", `/Users/${u.id}`, a.token, {
      Operations: [{ op: "replace", value: { active: true } }],
    });
    expect(((await on.json()) as ScimUser).active).toBe(true);
    const again = await login(app, `jiro@${a.domain}`);
    expect((await call(app, "GET", "/api/me", { cookie: again })).status).toBe(200);
  });

  it("名前を直せる。メールは変えられない(400 mutability)。DELETE は止めるだけで行は残る", async () => {
    const a = await scimOrg("scim-update");
    const u = await createUser(a, "saburo");
    const put = await scim("PUT", `/Users/${u.id}`, a.token, {
      userName: `saburo@${a.domain}`,
      displayName: "山田 三郎",
      externalId: "ext-saburo-2",
    });
    expect(((await put.json()) as ScimUser).displayName).toBe("山田 三郎");

    const rename = await scim("PATCH", `/Users/${u.id}`, a.token, {
      Operations: [{ op: "replace", path: "userName", value: `other@${a.domain}` }],
    });
    expect(rename.status).toBe(400);
    expect(((await rename.json()) as { scimType: string }).scimType).toBe("mutability");

    // 知らない項目(title など)は聞き流す
    const ignored = await scim("PATCH", `/Users/${u.id}`, a.token, {
      Operations: [{ op: "add", path: "title", value: "主任" }],
    });
    expect(ignored.status).toBe(200);

    expect((await scim("DELETE", `/Users/${u.id}`, a.token)).status).toBe(204);
    const got = await scim("GET", `/Users/${u.id}`, a.token);
    expect(got.status).toBe(200);
    expect(((await got.json()) as ScimUser).active).toBe(false);
  });
});

describe("SCIM の分離と記録", () => {
  it("他社の人・確かめたドメインの外の人は 404(見えない・止められない)", async () => {
    const a = await scimOrg("scim-iso-a");
    const b = await scimOrg("scim-iso-b");
    const bUser = await createUser(b, "shiro");
    expect((await scim("GET", `/Users/${bUser.id}`, a.token)).status).toBe(404);
    expect((await scim("DELETE", `/Users/${bUser.id}`, a.token)).status).toBe(404);
    expect((await scim("GET", `/Users/${bUser.id}`, b.token)).status).toBe(200);
    const bList = (await (await scim("GET", "/Users", b.token)).json()) as ScimList;
    expect(bList.Resources.find((r) => r.id === bUser.id)?.active).toBe(true);

    // 取引先(確かめたドメインの外)のメンバーを a に足しても、道具からは見えない
    const guestId = uuidv7();
    await withTenant(owner.db, a.tenantId, (tx) =>
      tx.insert(users).values({
        id: guestId,
        tenantId: a.tenantId,
        email: "guest@partner.test",
        name: "取引先",
        role: "member",
      }),
    );
    expect((await scim("GET", `/Users/${guestId}`, a.token)).status).toBe(404);
  });

  it("操作は監査ログに「SCIM が」として残る(行為者は鍵の ID・名前やメールは入れない)", async () => {
    const a = await scimOrg("scim-audit");
    const u = await createUser(a, "goro");
    await scim("PATCH", `/Users/${u.id}`, a.token, {
      Operations: [
        { op: "replace", path: "displayName", value: "山田 五郎" },
        { op: "replace", path: "active", value: false },
      ],
    });
    const actions = await scimActions(a);
    expect(actions.map((x) => x.action).sort()).toEqual([
      "scim.user_create",
      "scim.user_disable",
      "scim.user_update",
    ]);
    expect(actions.every((x) => x.target === u.id)).toBe(true);
    expect(actions.find((x) => x.action === "scim.user_update")?.details).toEqual({
      fields: ["name"],
    });
    expect(JSON.stringify(actions)).not.toContain("goro");
  });

  it("止めた人は人数に数えない(プランの人数)", async () => {
    const a = await scimOrg("scim-seats");
    const u = await createUser(a, "rokuro");
    const before = await call(app, "GET", "/api/organization/plan", { cookie: a.admin });
    const n = ((await before.json()) as { members: number }).members;
    await scim("DELETE", `/Users/${u.id}`, a.token);
    const after = await call(app, "GET", "/api/organization/plan", { cookie: a.admin });
    expect(((await after.json()) as { members: number }).members).toBe(n - 1);
  });
});

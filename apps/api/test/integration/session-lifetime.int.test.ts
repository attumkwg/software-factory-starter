import type { CreatedSupportGrant } from "@app/shared";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { createDb } from "../../src/db/client.ts";
import {
  call,
  createTenantFixture,
  createTestApp,
  login,
  type TenantFixture,
} from "../helpers/fixtures.ts";

// ログインの有効期間(docs/specs/0006-account-security.md・ADR 0017)の受け入れ条件。
// 無操作1時間+ログインから最長12時間。時計(Date だけ)を進めて確かめる。DB の時刻は使わない。

const owner = createDb(inject("ownerUrl"));
let a: TenantFixture;
let ops: TenantFixture;
let app: ReturnType<typeof createTestApp>["app"];
let pool: ReturnType<typeof createTestApp>["pool"];

const MIN = 60_000;
const start = Date.now();
/** 時計をログインからの分に合わせる(Date だけ。DB の接続のタイマーは本物のまま) */
const minutesLater = (minutes: number) =>
  vi.useFakeTimers({ now: start + minutes * MIN, toFake: ["Date"] });

const cookieOf = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? "";
const me = (cookie: string) => call(app, "GET", "/api/me", { cookie });
/** Cookie の値(人.組織.期限.ログインした時刻[.入室.見ている組織])。最後の . の後は署名 */
const partsOf = (cookie: string) =>
  decodeURIComponent(cookie.split("=")[1] ?? "")
    .split(".")
    .slice(0, -1);

async function loginNow(email: string) {
  minutesLater(0);
  return login(app, email);
}

beforeAll(async () => {
  a = await createTenantFixture(owner.db, "acme");
  ops = await createTenantFixture(owner.db, "ops");
  ({ app, pool } = createTestApp(inject("appUrl"), { SUPPORT_TENANT_ID: ops.tenantId }));
});
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  await owner.pool.end();
  await pool.end();
});

describe("無操作1時間", () => {
  it("1時間なにもしなければ、次の操作で 401", async () => {
    const cookie = await loginNow(a.users.member.email);
    minutesLater(59);
    expect((await me(cookie)).status).toBe(200);
    minutesLater(61);
    expect((await me(cookie)).status).toBe(401);
  });

  it("使っている間は延びる(出し直した Cookie で、最初のログインから1時間を過ぎても使える)", async () => {
    const first = await loginNow(a.users.member.email);
    minutesLater(40);
    const res = await me(first);
    expect(res.status).toBe(200);
    const renewed = cookieOf(res);
    expect(partsOf(renewed)[3]).toBe(partsOf(first)[3]); // ログインした時刻は変わらない
    minutesLater(90);
    expect((await me(renewed)).status).toBe(200);
    expect((await me(first)).status).toBe(401);
  });

  it("出し直しは1分に1回まで。公開の API(ログインが要らない)では出さない", async () => {
    const cookie = await loginNow(a.users.member.email);
    expect((await me(cookie)).headers.get("set-cookie")).toBeNull();
    minutesLater(2);
    const opts = await call(app, "GET", "/api/auth/options", { cookie });
    expect(opts.headers.get("set-cookie")).toBeNull();
    expect((await me(cookie)).headers.get("set-cookie")).toMatch(/^sid=/);
  });

  it("書き込みの API でも延びる(取り消しになった失敗では延ばさない)", async () => {
    const cookie = await loginNow(a.users.member.email);
    minutesLater(5);
    const ok = await call(app, "POST", "/api/projects", { cookie, body: { name: "延びる" } });
    expect(ok.status).toBe(201);
    expect(ok.headers.get("set-cookie")).toMatch(/^sid=/);
  });
});

describe("最長12時間", () => {
  it("使い続けても、ログインから12時間で 401", async () => {
    let cookie = await loginNow(a.users.viewer.email);
    for (let m = 50; m < 12 * 60; m += 50) {
      minutesLater(m);
      const res = await me(cookie);
      expect(res.status).toBe(200);
      cookie = cookieOf(res) || cookie;
    }
    minutesLater(12 * 60);
    expect((await me(cookie)).status).toBe(401);
  });
});

describe("代理ログイン", () => {
  it("代理に入っても・出ても、ログインした時刻を引き継ぐ。代理の Cookie も使っている間は延びる", async () => {
    const admin = await loginNow(a.users.admin.email);
    const grant = await call(app, "POST", "/api/support-grants", {
      cookie: admin,
      body: { hours: 24 },
    });
    const { code } = (await grant.json()) as CreatedSupportGrant;
    const staff = await loginNow(ops.users.member.email);

    minutesLater(10);
    const entered = await call(app, "POST", "/api/support/sessions", {
      cookie: staff,
      body: { code },
    });
    expect(entered.status).toBe(201);
    const acting = cookieOf(entered);
    expect(partsOf(acting)).toHaveLength(6);
    expect(partsOf(acting)[3]).toBe(partsOf(staff)[3]);

    minutesLater(40);
    const renewed = await me(acting);
    expect(renewed.status).toBe(200);
    expect(partsOf(cookieOf(renewed))).toHaveLength(6);

    const ended = await call(app, "POST", "/api/support/end", { cookie: cookieOf(renewed) });
    expect(ended.status).toBe(204);
    expect(partsOf(cookieOf(ended))).toHaveLength(4);
    expect(partsOf(cookieOf(ended))[3]).toBe(partsOf(staff)[3]);
  });
});

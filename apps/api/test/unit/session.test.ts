import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isRefreshDue,
  parseSession,
  readSession,
  refreshSession,
  type SessionConfig,
  writeSession,
} from "../../src/auth/session.ts";
import type { NewSession, Session } from "../../src/env.ts";

// ログインの有効期間(ADR 0017): 無操作1時間+ログインから最長12時間。Cookie だけで数える。

const cfg: SessionConfig = {
  secret: "s".repeat(32),
  idleSeconds: 3600,
  maxSeconds: 12 * 3600,
  secureCookie: false,
};
const USER = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";
const SUPPORT_SESSION = "33333333-3333-4333-8333-333333333333";
const ACTING = "44444444-4444-4444-8444-444444444444";
const T0 = 1_800_000_000;

afterEach(() => vi.useRealTimers());

const at = (seconds: number) => vi.useFakeTimers({ now: seconds * 1000, toFake: ["Date"] });

/** writeSession で出した Cookie を、readSession で読み直す(時刻は at() で決める) */
async function roundTrip(s: NewSession, writeAt: number, readAt: number) {
  at(writeAt);
  const write = new Hono().get("/", async (c) => {
    await writeSession(c, cfg, s);
    return c.body(null);
  });
  const setCookie = (await write.request("/")).headers.get("set-cookie") ?? "";
  at(readAt);
  const read = new Hono().get("/", async (c) => c.json(await readSession(c, cfg)));
  const res = await read.request("/", { headers: { cookie: setCookie.split(";")[0] ?? "" } });
  return { setCookie, session: (await res.json()) as Session | null };
}

describe("セッションの Cookie の形", () => {
  it("ふつうは「人.組織.期限.ログインした時刻」。期限は1時間先", () => {
    expect(parseSession(`${USER}.${TENANT}.${T0 + 3600}.${T0}`, cfg, T0)).toEqual({
      userId: USER,
      tenantId: TENANT,
      loggedInAt: T0,
      expiresAt: T0 + 3600,
    });
  });

  it("代理は6つ。見ている組織が tenantId、本来の組織が homeTenantId", () => {
    const raw = `${USER}.${TENANT}.${T0 + 3600}.${T0}.${SUPPORT_SESSION}.${ACTING}`;
    expect(parseSession(raw, cfg, T0)).toEqual({
      userId: USER,
      tenantId: ACTING,
      loggedInAt: T0,
      expiresAt: T0 + 3600,
      support: { sessionId: SUPPORT_SESSION, homeTenantId: TENANT },
    });
  });

  it("古い形(3つ・5つ)は読まない(出したときに1回だけログインし直し)", () => {
    expect(parseSession(`${USER}.${TENANT}.${T0 + 3600}`, cfg, T0)).toBeNull();
    const old = `${USER}.${TENANT}.${T0 + 3600}.${SUPPORT_SESSION}.${ACTING}`;
    expect(parseSession(old, cfg, T0)).toBeNull();
  });

  it("壊れた値は読まない", () => {
    expect(parseSession(`${USER}.${TENANT}.soon.${T0}`, cfg, T0)).toBeNull();
    expect(parseSession(`${USER}.${TENANT}.${T0 + 3600}.-1`, cfg, T0)).toBeNull();
    expect(parseSession(`x.${TENANT}.${T0 + 3600}.${T0}`, cfg, T0)).toBeNull();
    expect(
      parseSession(`${USER}.${TENANT}.${T0 + 3600}.${T0}.${SUPPORT_SESSION}.x`, cfg, T0),
    ).toBeNull();
  });
});

describe("切れる時", () => {
  it("1時間なにもしなければ切れる(59分は読める・60分で無い)", async () => {
    const s = { userId: USER, tenantId: TENANT };
    expect((await roundTrip(s, T0, T0 + 59 * 60)).session?.userId).toBe(USER);
    expect((await roundTrip(s, T0, T0 + 60 * 60)).session).toBeNull();
  });

  it("期限が残っていても、ログインから12時間で切れる", () => {
    const raw = `${USER}.${TENANT}.${T0 + 13 * 3600}.${T0}`;
    expect(parseSession(raw, cfg, T0 + 12 * 3600 - 1)).not.toBeNull();
    expect(parseSession(raw, cfg, T0 + 12 * 3600)).toBeNull();
  });

  it("出す期限は、ログインから12時間を超えない(Cookie の Max-Age も残りだけ)", async () => {
    const loggedInAt = T0 - (12 * 3600 - 600);
    const { setCookie, session } = await roundTrip(
      { userId: USER, tenantId: TENANT, loggedInAt },
      T0,
      T0,
    );
    expect(session?.expiresAt).toBe(T0 + 600);
    expect(setCookie).toMatch(/Max-Age=600/);
  });

  it("ログインした時刻が未来(時計のずれ1分を超える)なら読まない", () => {
    expect(parseSession(`${USER}.${TENANT}.${T0 + 3600}.${T0 + 61}`, cfg, T0)).toBeNull();
    expect(parseSession(`${USER}.${TENANT}.${T0 + 3600}.${T0 + 60}`, cfg, T0)).not.toBeNull();
  });

  it("代理に入っても、ログインした時刻を引き継げば12時間は延びない", async () => {
    const { session } = await roundTrip(
      {
        userId: USER,
        tenantId: ACTING,
        support: { sessionId: SUPPORT_SESSION, homeTenantId: TENANT },
        loggedInAt: T0,
      },
      T0 + 5 * 3600,
      T0 + 5 * 3600,
    );
    expect(session).toMatchObject({ loggedInAt: T0, tenantId: ACTING });
  });
});

describe("使っている間は延びる", () => {
  const session = (expiresAt: number): Session => ({
    userId: USER,
    tenantId: TENANT,
    loggedInAt: T0,
    expiresAt,
  });

  /** 関所と同じく、ハンドラーが答えた後に出し直す */
  const withRefresh = (s: Session) =>
    new Hono().use(async (c, next) => {
      await next();
      await refreshSession(c, cfg, s);
    });

  it("出してから1分たっていれば出し直す。1分未満なら出さない", () => {
    expect(isRefreshDue(cfg, session(T0 + 3600), T0 + 59)).toBe(false);
    expect(isRefreshDue(cfg, session(T0 + 3600), T0 + 60)).toBe(true);
  });

  it("12時間に届いていれば、延ばしても同じなので出さない", () => {
    const cap = T0 + 12 * 3600;
    expect(isRefreshDue(cfg, session(cap), cap - 10)).toBe(false);
  });

  it("出し直すと、期限が「いまから1時間」に延びる・ログインした時刻は変わらない", async () => {
    at(T0 + 30 * 60);
    const app = withRefresh(session(T0 + 3600)).get("/", (c) => c.body(null));
    const setCookie = (await app.request("/")).headers.get("set-cookie") ?? "";
    const value = decodeURIComponent(setCookie.split(";")[0]?.split("=")[1] ?? "");
    expect(value.startsWith(`${USER}.${TENANT}.${T0 + 90 * 60}.${T0}.`)).toBe(true);
  });

  it("ハンドラーが自分で出し直したときは、重ねて出さない", async () => {
    at(T0 + 30 * 60);
    const app = withRefresh(session(T0 + 3600)).get("/", async (c) => {
      await writeSession(c, cfg, { userId: USER, tenantId: ACTING, loggedInAt: T0 });
      return c.body(null);
    });
    expect((await app.request("/")).headers.getSetCookie()).toHaveLength(1);
  });
});

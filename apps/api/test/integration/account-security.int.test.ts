import { totp } from "@app/fake-cognito";
import type { Account, AuditEventPage, Me, MfaSetup } from "@app/shared";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { createDb } from "../../src/db/client.ts";
import {
  both,
  cookieOf,
  createCognitoApp,
  eventsOf,
  logIn,
  PASSWORD,
  reauth,
  signUp,
} from "../helpers/cognito.ts";
import { call, createTenantFixture, type TenantFixture } from "../helpers/fixtures.ts";

// 本人のアカウント(docs/specs/0006-account-security.md)の受け入れ条件を、偽物の Cognito と本物の Postgres で通す。
// 組織の必須と代理ログインは mfa-requirement.int.test.ts。

const owner = createDb(inject("ownerUrl"));
const t = createCognitoApp(inject("appUrl"));
let acme: TenantFixture;

const get = (path: string, cookie: string) => call(t.app, "GET", `/api${path}`, { cookie });
const post = (path: string, cookie: string, body?: unknown) =>
  call(t.app, "POST", `/api${path}`, { cookie, body });
/**
 * 時計(Date だけ)を進める。「ほかの端末を切る」は秒の単位で比べ、変えたのと同じ秒にログインした端末は残るので、
 * ほかの端末のログインと変更の間を2秒あける。時計は戻さない(戻すと、変更より前にログインしたことになる)
 */
const tick = (seconds = 2) => vi.setSystemTime(Date.now() + seconds * 1000);
const codeOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
  acme = await createTenantFixture(owner.db, "acme");
  for (const u of Object.values(acme.users)) await signUp(t, u.email);
});
afterAll(async () => {
  vi.useRealTimers();
  await owner.pool.end();
  await t.pool.end();
});

describe("二段階認証を自分で有効・無効にする", () => {
  let sid: string;
  let secret: string;

  it("パスワードを入れ直さないと鍵は出ない。違うパスワードは 400 reauth_failed", async () => {
    sid = await logIn(t, acme.users.member.email);
    expect(await codeOf(await post("/account/mfa/setup", sid))).toBe("reauth_required");
    const wrong = await post("/account/reauth", sid, { password: "Wrong-Password-1" });
    expect(wrong.status).toBe(400);
    expect(await codeOf(wrong)).toBe("reauth_failed");
  });

  it("入れ直すと QR(otpauth の URI)と手で入れる鍵が出る。違うコードでは有効にならない", async () => {
    const ticket = await reauth(t, sid);
    const res = await post("/account/mfa/setup", both(sid, ticket));
    const setup = (await res.json()) as MfaSetup;
    expect(setup.secret).toMatch(/^[A-Z2-7]+$/);
    expect(setup.otpauthUri).toContain(
      `otpauth://totp/Tasks%3A${encodeURIComponent(acme.users.member.email)}`,
    );
    expect(setup.otpauthUri).toContain(`secret=${setup.secret}`);
    const bad = await post("/account/mfa/enable", both(sid, ticket), { code: "000000" });
    expect(await codeOf(bad)).toBe("invalid_code");
    // 鍵はやり直すまで同じ物を使える
    tick();
    const ok = await post("/account/mfa/enable", both(sid, ticket), { code: totp(setup.secret) });
    expect(ok.status).toBe(204);
    secret = setup.secret;
    const renewed = cookieOf(ok, "sid") ?? "";
    // この端末は新しいセッションでログインのまま・ほかの端末(前の Cookie)は切れる
    expect((await get("/me", renewed)).status).toBe(200);
    expect((await get("/me", sid)).status).toBe(401);
    sid = renewed;
    // 札の Cookie は消した。古い札を送り直しても、中の Cognito のトークンは無効にしてあるので使えない
    expect(ok.headers.getSetCookie().some((c) => /^reauth=;/.test(c))).toBe(true);
    const replay = await post("/account/email", both(sid, ticket), { newEmail: "x@acme.test" });
    expect(await codeOf(replay)).toBe("reauth_required");
  });

  it("次のログインからコードを聞かれる。状態・お知らせ・監査ログに出る", async () => {
    sid = await logIn(t, acme.users.member.email, PASSWORD, secret);
    expect(((await (await get("/me", sid)).json()) as Me).mfa).toMatchObject({ enabled: true });
    expect(((await (await get("/account", sid)).json()) as Account).mfaEnabled).toBe(true);
    const events = await eventsOf(owner.db, acme.tenantId, "organizations.mfa_enabled");
    expect(events).toHaveLength(1);
    await t.handlers["organizations.mfa_enabled"]?.(events[0] as never);
    expect(t.sent.at(-1)).toMatchObject({ to: acme.users.member.email });
    expect(t.sent.at(-1)?.subject).toContain("二段階認証");
  });

  it("有効な人の入れ直しはコードも要る。パスワード+いまのコードで外せる", async () => {
    const noCode = await post("/account/reauth", sid, { password: PASSWORD });
    expect(await codeOf(noCode)).toBe("mfa_code_required");
    const off = await post("/account/mfa/disable", sid, { password: PASSWORD, code: totp(secret) });
    expect(off.status).toBe(204);
    sid = cookieOf(off, "sid") ?? "";
    // もうコードは聞かれない
    expect(await logIn(t, acme.users.member.email)).toMatch(/^sid=/);
    expect(await eventsOf(owner.db, acme.tenantId, "organizations.mfa_disabled")).toHaveLength(1);
    expect(
      await codeOf(await post("/account/mfa/disable", sid, { password: PASSWORD, code: "000000" })),
    ).toBe("mfa_not_enabled");
  });
});

describe("パスワードの変更", () => {
  const NEW = "New-Password-777";

  it("いまのパスワードが違えば変わらない・決まりを満たさなければ 400", async () => {
    const sid = await logIn(t, acme.users.viewer.email);
    const wrong = await post("/account/password", sid, {
      currentPassword: "Wrong-Password-1",
      newPassword: NEW,
    });
    expect(await codeOf(wrong)).toBe("reauth_failed");
    const weak = await post("/account/password", sid, {
      currentPassword: PASSWORD,
      newPassword: "short",
    });
    expect(await codeOf(weak)).toBe("invalid_password");
  });

  it("変えると新しいパスワードで入れる。ほかの端末は切れ、本人にお知らせ・監査ログ", async () => {
    const other = await logIn(t, acme.users.viewer.email);
    const sid = await logIn(t, acme.users.viewer.email);
    tick();
    const res = await post("/account/password", sid, {
      currentPassword: PASSWORD,
      newPassword: NEW,
    });
    expect(res.status).toBe(204);
    const renewed = cookieOf(res, "sid") ?? "";
    expect((await get("/me", renewed)).status).toBe(200);
    expect((await get("/me", other)).status).toBe(401);
    expect(await logIn(t, acme.users.viewer.email, NEW)).toMatch(/^sid=/);
    const [event] = await eventsOf(owner.db, acme.tenantId, "organizations.password_changed");
    await t.handlers["organizations.password_changed"]?.(event as never);
    expect(t.sent.at(-1)).toMatchObject({
      to: acme.users.viewer.email,
      subject: "パスワードが変更されました",
    });

    const admin = await logIn(t, acme.users.admin.email);
    const audit = (await (await get("/audit-events?limit=100", admin)).json()) as AuditEventPage;
    expect(audit.events.map((e) => e.action)).toContain("account.password_change");
  });
});

describe("メールアドレスの変更", () => {
  const next = `renamed-${Date.now()}@acme.test`;
  let sid: string;
  let ticket: string;

  it("申し込むと新しいアドレスに確認コード。確認するまでは古いアドレスのまま", async () => {
    sid = await logIn(t, acme.users.admin.email);
    expect(await codeOf(await post("/account/email", sid, { newEmail: next }))).toBe(
      "reauth_required",
    );
    ticket = await reauth(t, sid);
    const same = await post("/account/email", both(sid, ticket), {
      newEmail: acme.users.admin.email,
    });
    expect(same.status).toBe(400);
    const res = await post("/account/email", both(sid, ticket), { newEmail: next });
    expect(res.status).toBe(202);
    expect(t.fake.lastCode(next)).toMatch(/^\d{6}$/);
    expect(((await (await get("/account", sid)).json()) as Account).pendingEmail).toBe(next);
    expect(await logIn(t, acme.users.admin.email)).toMatch(/^sid=/);
  });

  it("違うコードは 400。正しいコードで替わり、新しいアドレスで入れる。古いアドレスにお知らせ", async () => {
    const bad = await post("/account/email/confirm", both(sid, ticket), { code: "000000" });
    expect(await codeOf(bad)).toBe("invalid_code");
    const ok = await post("/account/email/confirm", both(sid, ticket), {
      code: t.fake.lastCode(next),
    });
    expect(ok.status).toBe(204);
    const renewed = cookieOf(ok, "sid") ?? "";
    expect(((await (await get("/me", renewed)).json()) as Me).email).toBe(next);
    expect(await logIn(t, next)).toMatch(/^sid=/);
    const [event] = await eventsOf(owner.db, acme.tenantId, "organizations.email_changed");
    await t.handlers["organizations.email_changed"]?.(event as never);
    const mail = t.sent.at(-1);
    expect(mail?.to).toBe(acme.users.admin.email);
    expect(mail?.text).toContain("r***@a***.test");
    expect(mail?.text).not.toContain(next);
  });

  it("使われているアドレスは、申し込みでは同じ答え・確認の後に 409。Cognito のメールは替わらない", async () => {
    const memberSid = await logIn(t, acme.users.member.email);
    const memberTicket = await reauth(t, memberSid);
    const cookie = both(memberSid, memberTicket);
    const taken = acme.users.viewer.email;
    expect((await post("/account/email", cookie, { newEmail: taken })).status).toBe(202);
    const res = await post("/account/email/confirm", cookie, {
      code: t.fake.lastCode(taken) ?? "000000",
    });
    expect(await codeOf(res)).toBe("email_unavailable");
    expect(await logIn(t, acme.users.member.email)).toMatch(/^sid=/);
  });
});

describe("ログに秘密が出ない", () => {
  it("パスワード・コード・鍵・トークン・メールアドレスがログに無い", () => {
    const all = t.logs.join("\n");
    expect(all).not.toContain(PASSWORD);
    expect(all).not.toContain("New-Password-777");
    expect(all).not.toContain(acme.users.member.email);
    expect(all).not.toMatch(/eyJ[\w-]+\.[\w-]+\./);
    expect(all).not.toMatch(/otpauth:/);
    expect(all).not.toMatch(/"code":"\d{6}"/);
  });
});

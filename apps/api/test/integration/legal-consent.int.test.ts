import { LEGAL_VERSIONS, type LegalVersion } from "@app/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../../src/db/client.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { createCognitoApp, PASSWORD } from "../helpers/cognito.ts";
import {
  call,
  createTenantFixture,
  createTestApp,
  login,
  type TenantFixture,
} from "../helpers/fixtures.ts";

// 利用規約・プライバシーポリシーの同意(docs/specs/0009-legal-consent.md)。開発用ログインで通す(登録だけ偽物の Cognito)。
// 「効力の日が来た」「予告中」は、版の一覧を差し替えたアプリで作る(時計は止めない)。

const owner = createDb(inject("ownerUrl"));
const DAY = 86_400_000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const hash = "0".repeat(64);

/** 利用規約の版 2 を足した一覧(effectiveIn … いまから何ミリ秒後に効くか。負なら効いている) */
const withTermsV2 = (effectiveIn: number, reconsent = true): LegalVersion[] => [
  ...LEGAL_VERSIONS,
  {
    document: "terms",
    version: 2,
    publishedAt: iso(effectiveIn - 30 * DAY),
    effectiveAt: iso(effectiveIn),
    summary: "責任の範囲を変えます",
    reconsent,
    sha256: hash,
  },
];

const plain = createTestApp(inject("appUrl"));
const effective = createTestApp(inject("appUrl"), {}, { legalVersions: withTermsV2(-DAY) });
const upcoming = createTestApp(inject("appUrl"), {}, { legalVersions: withTermsV2(10 * DAY) });
const light = createTestApp(inject("appUrl"), {}, { legalVersions: withTermsV2(-DAY, false) });

let fresh: TenantFixture; // 誰も同意していない
let done: TenantFixture; // いまの版に同意済み
let other: TenantFixture;

beforeAll(async () => {
  fresh = await createTenantFixture(owner.db, "fresh", { consented: false });
  done = await createTenantFixture(owner.db, "done");
  other = await createTenantFixture(owner.db, "other", { consented: false });
});
afterAll(async () => {
  await owner.pool.end();
  for (const t of [plain, effective, upcoming, light]) await t.pool.end();
});

type App = typeof plain.app;
const me = async (app: App, cookie: string) => {
  const res = await call(app, "GET", "/api/me", { cookie });
  expect(res.status).toBe(200);
  return (await res.json()) as { legal?: { pending: unknown[]; upcoming: unknown[] } };
};
const accept = (app: App, cookie: string, consents: unknown) =>
  call(app, "POST", "/api/legal/consents", { cookie, body: { consents } });
const BOTH_V1 = [
  { document: "terms", version: 1 },
  { document: "privacy", version: 1 },
];

/** 表の持ち主でも FORCE RLS なので、組織の文脈を付けて読む */
async function consentRows(tenantId: string, userId?: string) {
  const r = await withTenant(owner.db, tenantId, (tx) =>
    tx.execute<{
      user_id: string;
      document: string;
      version: string;
      capacity: string;
      source: string;
    }>(
      sql`select user_id, document, version, capacity, source from legal.consents
        where tenant_id = ${tenantId} ${userId ? sql`and user_id = ${userId}` : sql``}
        order by document, version`,
    ),
  );
  return r.rows.map((row) => ({ ...row, version: Number(row.version) }));
}

describe("同意していない人(いまの版)", () => {
  it("ほかの API は 403 terms_acceptance_required。自分(GET /api/me)は通り、同意が要る版が出る", async () => {
    const cookie = await login(plain.app, fresh.users.member.email);
    const projects = await call(plain.app, "GET", "/api/projects", { cookie });
    expect(projects.status).toBe(403);
    expect(((await projects.json()) as { error: { code: string } }).error.code).toBe(
      "terms_acceptance_required",
    );
    expect((await me(plain.app, cookie)).legal).toEqual({ pending: BOTH_V1, upcoming: [] });
  });

  it("書き出しも止まる(同意しない人はログアウトしかできない。U-4)", async () => {
    const cookie = await login(plain.app, fresh.users.admin.email);
    expect((await call(plain.app, "POST", "/api/exports", { cookie })).status).toBe(403);
  });

  it("同意すると記録され、使えるようになる。管理者の利用規約は組織として、ほかは本人として", async () => {
    const admin = await login(plain.app, fresh.users.admin.email);
    expect((await accept(plain.app, admin, BOTH_V1)).status).toBe(204);
    expect((await call(plain.app, "GET", "/api/projects", { cookie: admin })).status).toBe(200);
    expect(await consentRows(fresh.tenantId, fresh.users.admin.id)).toEqual([
      expect.objectContaining({ document: "privacy", version: 1, capacity: "individual" }),
      expect.objectContaining({ document: "terms", version: 1, capacity: "organization" }),
    ]);

    const viewer = await login(plain.app, fresh.users.viewer.email);
    expect((await accept(plain.app, viewer, BOTH_V1)).status).toBe(204);
    expect(await consentRows(fresh.tenantId, fresh.users.viewer.id)).toEqual([
      expect.objectContaining({
        document: "privacy",
        capacity: "individual",
        source: "acceptance",
      }),
      expect.objectContaining({ document: "terms", capacity: "individual", source: "acceptance" }),
    ]);
  });

  it("同じ版に2回同意しても、記録は1つ。監査ログに legal.consent が残る", async () => {
    const cookie = await login(plain.app, fresh.users.admin.email);
    expect((await accept(plain.app, cookie, BOTH_V1)).status).toBe(204);
    expect(await consentRows(fresh.tenantId, fresh.users.admin.id)).toHaveLength(2);
    const audit = await withTenant(owner.db, fresh.tenantId, (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from platform.audit_events
            where tenant_id = ${fresh.tenantId} and actor_id = ${fresh.users.admin.id} and action = 'legal.consent'`,
      ),
    );
    expect(audit.rows[0]?.n).toBe(2);
  });

  it("無い版・公開前の版・同じ文書が2つは 400 で、何も記録しない", async () => {
    const cookie = await login(plain.app, fresh.users.member.email);
    const bad = [
      [{ document: "terms", version: 99 }],
      [
        { document: "terms", version: 1 },
        { document: "terms", version: 1 },
      ],
      [{ document: "cookie", version: 1 }],
    ];
    for (const consents of bad)
      expect((await accept(plain.app, cookie, consents)).status).toBe(400);
    expect(await consentRows(fresh.tenantId, fresh.users.member.id)).toEqual([]);
  });

  it("他社の人の同意は、自社の記録に入らない(組織はセッションからだけ)", async () => {
    const cookie = await login(plain.app, other.users.admin.email);
    expect((await accept(plain.app, cookie, BOTH_V1)).status).toBe(204);
    const rows = await consentRows(fresh.tenantId);
    expect(rows.every((r) => r.user_id !== other.users.admin.id)).toBe(true);
    expect(await consentRows(other.tenantId)).toHaveLength(2);
  });
});

describe("同意し直しが要る版が効いたとき", () => {
  it("前の版にしか同意していない人は止まる。新しい版に同意すれば通る", async () => {
    const cookie = await login(effective.app, done.users.member.email);
    expect((await call(effective.app, "GET", "/api/projects", { cookie })).status).toBe(403);
    expect((await me(effective.app, cookie)).legal?.pending).toEqual([
      { document: "terms", version: 2 },
    ]);
    // 古い版(1)にはもう同意できない
    expect((await accept(effective.app, cookie, [{ document: "terms", version: 1 }])).status).toBe(
      400,
    );
    expect((await accept(effective.app, cookie, [{ document: "terms", version: 2 }])).status).toBe(
      204,
    );
    expect((await call(effective.app, "GET", "/api/projects", { cookie })).status).toBe(200);
  });

  it("同意し直しの要らない版なら、知らせるだけで止まらない", async () => {
    const cookie = await login(light.app, done.users.viewer.email);
    expect((await call(light.app, "GET", "/api/projects", { cookie })).status).toBe(200);
    expect((await me(light.app, cookie)).legal).toEqual({ pending: [], upcoming: [] });
  });
});

describe("予告中の版", () => {
  it("帯に出る。前もって同意すれば、効力の日に止まらない", async () => {
    const cookie = await login(upcoming.app, done.users.admin.email);
    expect((await call(upcoming.app, "GET", "/api/projects", { cookie })).status).toBe(200);
    expect((await me(upcoming.app, cookie)).legal?.upcoming).toEqual([
      expect.objectContaining({ document: "terms", version: 2, reconsent: true, accepted: false }),
    ]);
    expect((await accept(upcoming.app, cookie, [{ document: "terms", version: 2 }])).status).toBe(
      204,
    );
    expect((await me(upcoming.app, cookie)).legal?.upcoming).toEqual([
      expect.objectContaining({ version: 2, accepted: true }),
    ]);
    // 効力の日が来た一覧のアプリでも、止まらない
    const later = await login(effective.app, done.users.admin.email);
    expect((await call(effective.app, "GET", "/api/projects", { cookie: later })).status).toBe(200);
  });
});

describe("対象にしない人", () => {
  it("運営の組織の人は、同意していなくても止まらない(me に legal も無い)", async () => {
    const staffOrg = await createTenantFixture(owner.db, "ops", { consented: false });
    const ops = createTestApp(inject("appUrl"), { SUPPORT_TENANT_ID: staffOrg.tenantId });
    try {
      const cookie = await login(ops.app, staffOrg.users.member.email);
      expect((await call(ops.app, "GET", "/api/projects", { cookie })).status).toBe(200);
      expect((await me(ops.app, cookie)).legal).toBeUndefined();
    } finally {
      await ops.pool.end();
    }
  });
});

describe("書き出し", () => {
  it("同意の記録が入る(人の ID・版・組織としてか・画面・時刻)", async () => {
    const cookie = await login(plain.app, done.users.admin.email);
    const res = await call(plain.app, "POST", "/api/exports", { cookie });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { legalConsents: { userId: string; capacity: string }[] };
    // 3人 × 2つの文書(ほかのテストで版 2 に同意した分が足されていることもある)
    expect(data.legalConsents.length).toBeGreaterThanOrEqual(6);
    expect(data.legalConsents).toContainEqual(
      expect.objectContaining({ userId: done.users.admin.id, capacity: "organization" }),
    );
  });
});

describe("登録の画面での同意(Cognito)", () => {
  const t = createCognitoApp(inject("appUrl"));
  afterAll(() => t.pool.end());

  const signUp = async (email: string, consents: unknown, code?: string) => {
    await call(t.app, "POST", "/api/auth/sign-up", { body: { email, password: PASSWORD } });
    return call(t.app, "POST", "/api/auth/confirm-sign-up", {
      body: { email, code: code ?? t.fake.lastCode(email), consents },
    });
  };

  it("確認コードが通った後、アプリにいる人なら、見せた版への同意を「登録」として記録する", async () => {
    const org = await createTenantFixture(owner.db, "signup", { consented: false });
    const res = await signUp(org.users.admin.email, BOTH_V1);
    expect(res.status).toBe(200);
    expect(await consentRows(org.tenantId, org.users.admin.id)).toEqual([
      expect.objectContaining({ document: "privacy", capacity: "individual", source: "sign_up" }),
      expect.objectContaining({ document: "terms", capacity: "organization", source: "sign_up" }),
    ]);
  });

  it("確認コードが違えば記録しない", async () => {
    const org = await createTenantFixture(owner.db, "badcode", { consented: false });
    const res = await signUp(org.users.member.email, BOTH_V1, "000000");
    expect(res.status).toBe(400);
    expect(await consentRows(org.tenantId)).toEqual([]);
  });

  it("アプリにいない人は記録しない。答えは同じ(200)", async () => {
    const res = await signUp(`nobody-${Date.now()}@example.test`, BOTH_V1);
    expect(res.status).toBe(200);
    expect(t.logs.some((l) => l.includes('"reason":"not_registered"'))).toBe(true);
  });
});

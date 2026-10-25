import { currentPreRegistrationConsent, PRE_REGISTRATION_RETENTION_DAYS } from "@app/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { lpDailyCounts, outbox, preRegistrations } from "../../src/db/schema.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { makeLinkToken } from "../../src/domains/growth/links.ts";
import { call, createTestApp } from "../helpers/fixtures.ts";
import {
  createGrowthHarness,
  newLeadEmail as email,
  type GrowthHarness,
  LINK_KEY,
  PRIVACY_URL,
  SITE,
  tokenIn,
} from "../helpers/growth.ts";

// 公開の LP の入口(docs/specs/0025-public-landing-page.md の受け入れ条件)。お客さん(a)と運営(ops)。
// 運営のコマンドと組織へのつなぎは growth-commands.int.test.ts。

let h: GrowthHarness;
beforeAll(async () => {
  h = await createGrowthHarness(inject("ownerUrl"), inject("appUrl"));
});
afterAll(() => h.close());

const confirm = (token: string) => h.post("/api/public/pre-registrations/confirm", { token });
const withdraw = (token: string) => h.post("/api/public/pre-registrations/withdraw", { token });

describe("事前登録を受ける", () => {
  it("同意のチェックが無ければ 400・古い同意の文の版も 400", async () => {
    expect((await h.register(email(), { consent: false })).status).toBe(400);
    expect((await h.register(email(), { consentTextVersion: 999 })).status).toBe(400);
  });

  it("登録すると、運営の組織に確認待ちの行・登録の数・確認のメールの出来事(中身は ID だけ)ができる", async () => {
    const address = email().toUpperCase();
    const before = (await h.countsOf("koumuten-kai"))?.registrations ?? 0;
    expect((await h.register(address)).status).toBe(204);
    const row = await h.rowOf(address.toLowerCase());
    expect(row).toMatchObject({
      status: "pending",
      companySize: "10-49",
      utmSource: "koumuten-kai",
      landingPath: "/",
      consentTextVersion: currentPreRegistrationConsent().version,
    });
    expect((await h.countsOf("koumuten-kai"))?.registrations).toBe(before + 1);
    const [event] = await h.asOps((tx) =>
      tx
        .select({ payload: outbox.payload })
        .from(outbox)
        .where(sql`${outbox.payload}->>'preRegistrationId' = ${row?.id}`),
    );
    expect(event?.payload).toEqual({ preRegistrationId: row?.id });
  });

  it("同じアドレスは行を作らず、同じ答え。24時間たつまで確認のメールを送り直さない", async () => {
    const address = email();
    await h.register(address);
    expect((await h.register(address, { organizationName: "別の名前" })).status).toBe(204);
    const row = await h.rowOf(address);
    expect(row?.organizationName).toBe("サンプル商事(架空)");
    expect(await h.confirmEvents(row?.id ?? "")).toBe(1);

    const dayAgo = new Date(Date.now() - 25 * 3600_000);
    await h.asOps((tx) =>
      tx
        .update(preRegistrations)
        .set({ confirmSentAt: dayAgo })
        .where(eq(preRegistrations.id, row?.id ?? "")),
    );
    await h.register(address);
    expect(await h.confirmEvents(row?.id ?? "")).toBe(2);
  });

  it("罠の欄に値があれば、何もせずに同じ答え", async () => {
    const address = email();
    expect((await h.register(address, { website: "https://spam.example" })).status).toBe(204);
    expect(await h.rowOf(address)).toBeUndefined();
  });

  it("他の組織の文脈(アプリの接続)からは、事前登録が見えない", async () => {
    await h.register(email());
    const seen = await withTenant(h.appDb.db, h.a.tenantId, (tx) =>
      tx.select({ n: sql<number>`count(*)::int` }).from(preRegistrations),
    );
    expect(seen[0]?.n).toBe(0);
  });
});

describe("確認と取り消し", () => {
  it("確認のメールのリンクを開くと confirmed になり、消す日が登録から1年に延びる。2回開いても 204", async () => {
    const address = email();
    await h.register(address);
    const row = await h.rowOf(address);
    const mail = await h.mailFor(row?.id ?? "");
    if ("skip" in mail) throw new Error(mail.skip);
    expect(mail.to).toBe(address);
    expect(mail.text).toContain(PRIVACY_URL);
    const token = tokenIn(mail, "confirm");
    const before = (await h.countsOf("koumuten-kai"))?.confirmations ?? 0;

    expect((await confirm(token)).status).toBe(204);
    const after = await h.rowOf(address);
    expect(after?.status).toBe("confirmed");
    const oneYear = new Date(
      (row?.createdAt.getTime() ?? 0) + PRE_REGISTRATION_RETENTION_DAYS.confirmed * 86_400_000,
    );
    expect(after?.deleteAfter).toBe(oneYear.toISOString().slice(0, 10));
    expect((await h.countsOf("koumuten-kai"))?.confirmations).toBe(before + 1);

    expect((await confirm(token)).status).toBe(204);
    expect(await h.mailFor(row?.id ?? "")).toEqual({ skip: "already_confirmed" });
  });

  it("署名の合わない token・期限の切れたリンクは 400", async () => {
    const address = email();
    await h.register(address);
    const row = await h.rowOf(address);
    expect((await confirm(`${row?.id}.${"A".repeat(43)}`)).status).toBe(400);

    const old = new Date(Date.now() - 8 * 86_400_000);
    await h.asOps((tx) =>
      tx
        .update(preRegistrations)
        .set({ confirmSentAt: old })
        .where(eq(preRegistrations.id, row?.id ?? "")),
    );
    const stored = await h.rowOf(address);
    const expired = makeLinkToken(LINK_KEY, "confirm", row?.id ?? "", stored?.confirmSentAt ?? old);
    expect((await confirm(expired)).status).toBe(400);
    expect((await h.rowOf(address))?.status).toBe("pending");
  });

  it("取り消しのリンクで行が消える。無い登録でも同じ答え", async () => {
    const address = email();
    await h.register(address);
    const row = await h.rowOf(address);
    const mail = await h.mailFor(row?.id ?? "");
    if ("skip" in mail) throw new Error(mail.skip);
    const token = tokenIn(mail, "withdraw");
    expect((await withdraw(token)).status).toBe(204);
    expect(await h.rowOf(address)).toBeUndefined();
    expect((await withdraw(token)).status).toBe(204);
  });
});

describe("見た数", () => {
  it("UTM ごとに足す。英数と -_. 以外の UTM は空にする(メールアドレスを残さない)", async () => {
    const source = `ad-${email().slice(5, 13)}`;
    for (let i = 0; i < 2; i++) {
      const res = await h.post("/api/public/lp-views", {
        path: "/",
        utmSource: source,
        utmMedium: "cpc",
      });
      expect(res.status).toBe(204);
    }
    expect((await h.countsOf(source))?.views).toBe(2);

    await h.post("/api/public/lp-views", {
      path: "/",
      utmSource: "someone@example.test",
      utmCampaign: "x",
    });
    const leaked = await h.asOps((tx) =>
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(lpDailyCounts)
        .where(sql`${lpDailyCounts.utmSource} like '%@%'`),
    );
    expect(leaked[0]?.n).toBe(0);
  });
});

describe("設定と CORS", () => {
  it("公開の LP の URL が設定に無ければ、公開の入口は 404", async () => {
    const { app: plain, pool } = createTestApp(inject("appUrl"));
    try {
      const res = await call(plain, "POST", "/api/public/lp-views", { body: { path: "/" } });
      expect(res.status).toBe(404);
    } finally {
      await pool.end();
    }
  });

  it("CORS は公開の LP の origin にだけ開く(資格情報なし)", async () => {
    const preflight = (origin: string) =>
      h.app.request("/api/public/pre-registrations", {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      });
    const ok = await preflight(SITE);
    expect(ok.headers.get("access-control-allow-origin")).toBe(SITE);
    expect(ok.headers.get("access-control-allow-credentials")).toBeNull();
    const other = await preflight("https://evil.example");
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});

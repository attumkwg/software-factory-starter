import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../../src/db/client.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { notifyLegalChange } from "../../src/legal-notify/notify.ts";
import { createCognitoApp, eventsOf } from "../helpers/cognito.ts";
import { createTenantFixture, type TenantFixture } from "../helpers/fixtures.ts";

// 規約の変更のお知らせ(運営のコマンド legal-notify の中身。docs/specs/0009-legal-consent.md・docs/runbooks/legal-notice.md)。
// 試し → 送る(お知らせの行と出来事)→ 2回目は0件 → 受け手がメールを組み立てる。

const owner = createDb(inject("ownerUrl"));
const ref = { document: "terms" as const, version: 1 };
let a: TenantFixture;
let ops: TenantFixture;

beforeAll(async () => {
  a = await createTenantFixture(owner.db, "notice");
  ops = await createTenantFixture(owner.db, "ops");
});
afterAll(() => owner.pool.end());

/** 表の持ち主でも FORCE RLS なので、組織の文脈を付けて数える */
const noticesOf = async (tenantId: string) =>
  (
    await withTenant(owner.db, tenantId, (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from legal.notices where tenant_id = ${tenantId}`,
      ),
    )
  ).rows[0]?.n;

describe("legal-notify", () => {
  it("試しは数えるだけ(行も出来事も足さない)。運営の組織は飛ばす", async () => {
    const plan = await notifyLegalChange(owner.db, ref, {
      execute: false,
      supportTenantId: ops.tenantId,
    });
    expect(plan.counts[a.tenantId]).toBe(3);
    expect(plan.counts[ops.tenantId]).toBeUndefined();
    expect(await noticesOf(a.tenantId)).toBe(0);
    expect(await eventsOf(owner.db, a.tenantId, "legal.change_notified")).toEqual([]);
  });

  it("送ると、全員に1件ずつお知らせの行と出来事を足す。2回目は0件", async () => {
    const opts = { execute: true, supportTenantId: ops.tenantId };
    expect((await notifyLegalChange(owner.db, ref, opts)).counts[a.tenantId]).toBe(3);
    expect(await noticesOf(a.tenantId)).toBe(3);
    expect(await noticesOf(ops.tenantId)).toBe(0);
    expect(await eventsOf(owner.db, a.tenantId, "legal.change_notified")).toHaveLength(3);

    expect((await notifyLegalChange(owner.db, ref, opts)).counts[a.tenantId]).toBe(0);
    expect(await eventsOf(owner.db, a.tenantId, "legal.change_notified")).toHaveLength(3);
    const plan = await notifyLegalChange(owner.db, ref, { ...opts, execute: false });
    expect(plan.counts[a.tenantId]).toBe(0);
  });

  it("受け手が、本人のいまのアドレスへ、要約・効力の日・本文へのリンクのメールを組み立てる", async () => {
    const t = createCognitoApp(inject("appUrl"));
    try {
      const events = await eventsOf(owner.db, a.tenantId, "legal.change_notified");
      for (const event of events) await t.handlers["legal.change_notified"]?.(event);
      expect(t.sent.map((m) => m.to).sort()).toEqual(
        [a.users.admin.email, a.users.member.email, a.users.viewer.email].sort(),
      );
      const mail = t.sent[0];
      expect(mail?.subject).toMatch(/^利用規約を .+ に変更します$/);
      expect(mail?.text).toContain("変更の要約: 最初の版");
      expect(mail?.text).toContain("http://localhost:8080/legal/terms/1");
      // 2回届いても同じ Message-ID
      const first = events[0];
      if (first) await t.handlers["legal.change_notified"]?.(first);
      expect(t.sent.at(-1)?.messageId).toBe(
        t.sent.find((m) => m.to === t.sent.at(-1)?.to)?.messageId,
      );
    } finally {
      await t.pool.end();
    }
  });
});

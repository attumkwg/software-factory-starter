import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { auditEvents, preRegistrations } from "../../src/db/schema.ts";
import {
  loadPreRegistrationForTenant,
  markPreRegistrationConverted,
} from "../../src/domains/growth/index.ts";
import {
  runPreRegistrationDelete,
  runPreRegistrationPurge,
  runPreRegistrationReport,
} from "../../src/pre-registrations/index.ts";
import {
  createGrowthHarness,
  newLeadEmail as email,
  type GrowthHarness,
  tokenIn,
} from "../helpers/growth.ts";

// 事前登録の運営のコマンドと、組織を作るコマンド(G-01)へのつなぎ(docs/specs/0025-public-landing-page.md・
// docs/runbooks/pre-registrations.md)。公開の入口は growth-public.int.test.ts。

let h: GrowthHarness;
beforeAll(async () => {
  h = await createGrowthHarness(inject("ownerUrl"), inject("appUrl"));
});
afterAll(() => h.close());

describe("運営のコマンド", () => {
  it("report は来た所ごとの数と率だけを出す(メールアドレス・会社名は出さない)", async () => {
    const source = `report-${uuidv7().slice(-8)}`;
    await h.post("/api/public/lp-views", { path: "/", utmSource: source });
    await h.post("/api/public/lp-views", { path: "/", utmSource: source });
    const address = email();
    await h.register(address, { utmSource: source, utmMedium: "", utmCampaign: "" });
    const [line = ""] = await runPreRegistrationReport(h.owner.db, h.ops.tenantId, []);
    expect(line).not.toContain(address);
    expect(line).not.toContain("サンプル商事");
    const report = JSON.parse(line) as {
      sources: { utmSource: string; views: number; registrations: number }[];
    };
    expect(report.sources.find((s) => s.utmSource === source)).toMatchObject({
      views: 2,
      registrations: 1,
      registrationRate: 50,
    });
  });

  it("delete は試しで数えるだけ、--execute で消して運営の組織の監査ログに残す", async () => {
    const address = email();
    await h.register(address);
    const plan = await runPreRegistrationDelete(h.owner.db, h.ops.tenantId, address, []);
    expect(JSON.parse(plan[0] ?? "")).toEqual({ mode: "plan", found: 1 });
    expect(await h.rowOf(address)).toBeDefined();
    const done = await runPreRegistrationDelete(
      h.owner.db,
      h.ops.tenantId,
      ` ${address.toUpperCase()}`,
      ["--execute"],
    );
    expect(JSON.parse(done[0] ?? "")).toEqual({ mode: "deleted", found: 1 });
    expect(await h.rowOf(address)).toBeUndefined();
    const audit = await h.asOps((tx) =>
      tx
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.tenantId, h.ops.tenantId),
            eq(auditEvents.action, "pre_registration.deleted"),
          ),
        ),
    );
    expect(audit.length).toBeGreaterThan(0);
  });

  it("purge は消す日を過ぎた登録だけを消す", async () => {
    const expired = email();
    const fresh = email();
    await h.register(expired);
    await h.register(fresh);
    await h.asOps((tx) =>
      tx
        .update(preRegistrations)
        .set({ deleteAfter: "2000-01-01" })
        .where(eq(preRegistrations.email, expired)),
    );
    const plan = JSON.parse(
      (await runPreRegistrationPurge(h.owner.db, h.ops.tenantId, []))[0] ?? "",
    );
    expect(plan.mode).toBe("plan");
    expect(plan.preRegistrations).toBeGreaterThanOrEqual(1);
    expect(await h.rowOf(expired)).toBeDefined();
    await runPreRegistrationPurge(h.owner.db, h.ops.tenantId, ["--execute"]);
    expect(await h.rowOf(expired)).toBeUndefined();
    expect(await h.rowOf(fresh)).toBeDefined();
  });
});

describe("組織を作るコマンドへのつなぎ", () => {
  it("確認済みの登録だけを入力にでき、組織にしたら converted(同じ組織で2回呼んでもよい)", async () => {
    const address = email();
    await h.register(address);
    const id = (await h.rowOf(address))?.id ?? "";
    const load = () => h.asOps((tx) => loadPreRegistrationForTenant(tx, h.ops.tenantId, id));
    expect(await load()).toBeNull();

    const mail = await h.mailFor(id);
    if ("skip" in mail) throw new Error(mail.skip);
    await h.post("/api/public/pre-registrations/confirm", { token: tokenIn(mail, "confirm") });
    expect(await load()).toEqual({
      preRegistrationId: id,
      organizationName: "サンプル商事(架空)",
      adminEmail: address,
    });

    const mark = (tenantId: string) =>
      h.asOps((tx) => markPreRegistrationConverted(tx, h.ops.tenantId, id, tenantId));
    expect(await mark(h.a.tenantId)).toBe(true);
    expect(await mark(h.a.tenantId)).toBe(true);
    expect(await h.rowOf(address)).toMatchObject({
      status: "converted",
      convertedTenantId: h.a.tenantId,
    });
    expect(await load()).toBeNull();
    expect(await mark(uuidv7())).toBe(false);
  });
});

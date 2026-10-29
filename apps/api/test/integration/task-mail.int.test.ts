import type { AuditEventPage, TaskMail } from "@app/shared";
import { count, eq } from "drizzle-orm";
import { afterAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../../src/db/client.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { findTaskMailEnabled } from "../../src/domains/organizations/index.ts";
import { tenants } from "../../src/domains/organizations/schema.ts";
import { call, createTenantFixture, createTestApp, login } from "../helpers/fixtures.ts";

// 組織の「タスクが完了したメール」を止める・戻す(docs/specs/0093-task-mail-switch.md)の受け入れ条件のうち、組織の側。
// 止めた組織には送らないのは mail.int.test.ts、権限の表の3行は authz-matrix.int.test.ts。

const owner = createDb(inject("ownerUrl"));
const { app, pool } = createTestApp(inject("appUrl"));

afterAll(async () => {
  await owner.pool.end();
  await pool.end();
});

const state = async (cookie: string) =>
  (await (await call(app, "GET", "/api/organization/task-mail", { cookie })).json()) as TaskMail;
const turnOff = (cookie: string) => call(app, "DELETE", "/api/organization/task-mail", { cookie });
const turnOn = (cookie: string) => call(app, "POST", "/api/organization/task-mail", { cookie });
const enabledIn = (tenantId: string) =>
  withTenant(owner.db, tenantId, (tx) => findTaskMailEnabled(tx, tenantId));

describe("組織の管理者が「タスクが完了したメール」を止める・戻す", () => {
  it("既定は送る。止めると自分の組織だけが止まり、戻すと送るに戻る(同じ向きをもう一度でも 204)", async () => {
    const acme = await createTenantFixture(owner.db, "acme-task-mail");
    const globex = await createTenantFixture(owner.db, "globex-task-mail");
    const admin = await login(app, acme.users.admin.email);

    expect(await state(admin)).toEqual({ enabled: true });
    expect((await turnOff(admin)).status).toBe(204);
    expect((await turnOff(admin)).status).toBe(204);
    expect(await state(admin)).toEqual({ enabled: false });
    expect(await enabledIn(acme.tenantId)).toBe(false);
    // 他社は変わらない(テナントはセッションから)
    expect(await enabledIn(globex.tenantId)).toBe(true);

    expect((await turnOn(admin)).status).toBe(204);
    expect(await state(admin)).toEqual({ enabled: true });
  });

  it("管理者でない人は読む・止める・戻すのどれも 403", async () => {
    const acme = await createTenantFixture(owner.db, "acme-task-mail-roles");
    for (const who of [acme.users.member, acme.users.viewer]) {
      const cookie = await login(app, who.email);
      expect((await call(app, "GET", "/api/organization/task-mail", { cookie })).status).toBe(403);
      expect((await turnOff(cookie)).status).toBe(403);
      expect((await turnOn(cookie)).status).toBe(403);
    }
    expect(await enabledIn(acme.tenantId)).toBe(true);
  });

  it("止めた・戻したは監査ログに名前で残る(誰が・いつ)", async () => {
    const acme = await createTenantFixture(owner.db, "acme-task-mail-audit");
    const admin = await login(app, acme.users.admin.email);
    await turnOff(admin);
    await turnOn(admin);
    const audit = (await (
      await call(app, "GET", "/api/audit-events?limit=100", { cookie: admin })
    ).json()) as AuditEventPage;
    const actions = audit.events.map((e) => e.action);
    expect(actions).toContain("organization.task_mail_off");
    expect(actions).toContain("organization.task_mail_on");
  });

  it("止めている組織の数を、組織の名前を使わずに集計で数えられる", async () => {
    const acme = await createTenantFixture(owner.db, "acme-task-mail-count");
    const off = async () =>
      (
        await owner.db
          .select({ n: count() })
          .from(tenants)
          .where(eq(tenants.taskCompletedMail, false))
      )[0]?.n ?? 0;
    const before = await off();
    await turnOff(await login(app, acme.users.admin.email));
    expect(await off()).toBe(before + 1);
  });
});

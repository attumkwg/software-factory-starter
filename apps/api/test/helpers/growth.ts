import { currentPreRegistrationConsent } from "@app/shared";
import { and, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { createDb, type TenantTx } from "../../src/db/client.ts";
import { lpDailyCounts, outbox, preRegistrations } from "../../src/db/schema.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { linkKey, preRegistrationConfirmMail } from "../../src/domains/growth/index.ts";
import type { MailMessage } from "../../src/mail/index.ts";
import type { OutboxEvent } from "../../src/outbox/index.ts";
import { call, createTenantFixture, createTestApp } from "./fixtures.ts";

// 公開の LP の入口のテストの部品(docs/specs/0025-public-landing-page.md)。お客さん(a)と運営(ops)を作り、
// 公開の LP の URL と運営の組織を設定したアプリを組み立てる。運営の組織はテストのファイルごとに作るので、
// 日ごとの数はほかのテストと混ざらない。

export const SITE = "https://www.example.test";
/** createTestApp の SESSION_SECRET から作った、リンクの鍵 */
export const LINK_KEY = linkKey("test-only-".padEnd(40, "x"));
export const PRIVACY_URL = "http://localhost:8080/legal/privacy";

export const newLeadEmail = () => `lead-${uuidv7().slice(-12)}@example.test`;

export function registrationBody(address: string, extra: Record<string, unknown> = {}) {
  return {
    email: address,
    organizationName: "サンプル商事(架空)",
    companySize: "10-49",
    consent: true,
    consentTextVersion: currentPreRegistrationConsent().version,
    utmSource: "koumuten-kai",
    utmMedium: "email",
    utmCampaign: "launch-2026-11",
    landingPath: "/?utm_source=koumuten-kai",
    ...extra,
  };
}

/** メールの本文から、公開のページのリンクの token を取り出す */
export function tokenIn(mail: MailMessage, page: "confirm" | "withdraw"): string {
  const m = mail.text.match(new RegExp(`${SITE}/${page}#t=(\\S+)`));
  if (!m?.[1]) throw new Error(`${page} のリンクがありません`);
  return m[1];
}

export async function createGrowthHarness(ownerUrl: string, appUrl: string) {
  const owner = createDb(ownerUrl);
  const appDb = createDb(appUrl);
  const a = await createTenantFixture(owner.db, "acme");
  const ops = await createTenantFixture(owner.db, "ops");
  const { app, pool } = createTestApp(appUrl, {
    PUBLIC_SITE_URL: SITE,
    SUPPORT_TENANT_ID: ops.tenantId,
  });

  const asOps = <T>(fn: (tx: TenantTx) => Promise<T>) => withTenant(owner.db, ops.tenantId, fn);

  return {
    owner,
    appDb,
    a,
    ops,
    app,
    asOps,
    close: async () => {
      await owner.pool.end();
      await appDb.pool.end();
      await pool.end();
    },
    register: (address: string, extra: Record<string, unknown> = {}) =>
      call(app, "POST", "/api/public/pre-registrations", {
        body: registrationBody(address, extra),
      }),
    post: (path: string, body: unknown) => call(app, "POST", path, { body }),
    rowOf: async (address: string) =>
      (
        await asOps((tx) =>
          tx
            .select()
            .from(preRegistrations)
            .where(
              and(eq(preRegistrations.tenantId, ops.tenantId), eq(preRegistrations.email, address)),
            ),
        )
      )[0],
    confirmEvents: async (id: string) =>
      (
        await asOps((tx) =>
          tx
            .select()
            .from(outbox)
            .where(
              and(
                eq(outbox.tenantId, ops.tenantId),
                eq(outbox.topic, "growth.pre_registration_received"),
                sql`${outbox.payload}->>'preRegistrationId' = ${id}`,
              ),
            ),
        )
      ).length,
    countsOf: async (source: string) =>
      (
        await asOps((tx) =>
          tx
            .select({
              views: sql<number>`sum(${lpDailyCounts.views})::int`,
              registrations: sql<number>`sum(${lpDailyCounts.registrations})::int`,
              confirmations: sql<number>`sum(${lpDailyCounts.confirmations})::int`,
            })
            .from(lpDailyCounts)
            .where(
              and(eq(lpDailyCounts.tenantId, ops.tenantId), eq(lpDailyCounts.utmSource, source)),
            ),
        )
      )[0],
    /** 確認のメールを組み立てる(アウトボックスの受け手と同じ) */
    mailFor: (id: string) =>
      asOps((tx) =>
        preRegistrationConfirmMail(
          tx,
          { id: uuidv7(), tenantId: ops.tenantId } as OutboxEvent,
          { preRegistrationId: id },
          { url: SITE, key: LINK_KEY, privacyUrl: PRIVACY_URL },
        ),
      ),
  };
}

export type GrowthHarness = Awaited<ReturnType<typeof createGrowthHarness>>;

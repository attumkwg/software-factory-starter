import { bigint, index, pgSchema, primaryKey, text, unique, uuid } from "drizzle-orm/pg-core";
import { dateOnly, id, instant } from "../../db/columns.ts";
import { tenants } from "../organizations/schema.ts";

// 領域「集客」(docs/specs/0025-public-landing-page.md・設計書 0025 の 2・ADR 0038)。Postgres のスキーマ growth に置く。
// 公開の LP(apps/site)の事前登録と、来た所ごとの日ごとの数。**どちらも運営の組織(SUPPORT_TENANT_ID)の持ち物**で、
// tenant_id は運営の組織。公開の入口はテナントをリクエストから決めず、設定の運営の組織に固定する。
// 組織の中の人が使う API は無い(読む・消す・組織にするのは運営のコマンドだけ)。

export const growth = pgSchema("growth");

/**
 * 事前登録。確認のリンクを開くまで pending → 開いたら confirmed → 組織を作るコマンドに渡したら converted。
 * 取り消し(本人のリンク・運営のコマンド)は行を消す(止める一覧も残さない)。
 * delete_after を過ぎたら pre-registrations-purge が消す(期間は @app/shared の PRE_REGISTRATION_RETENTION_DAYS)。
 * 確認・取り消しのリンクは行の ID と時刻から HMAC で作る(token を DB に持たない。links.ts)。
 */
export const preRegistrations = growth.table(
  "pre_registrations",
  {
    id: id("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    /** 小文字に寄せて持つ */
    email: text("email").notNull(),
    organizationName: text("organization_name").notNull(),
    /** COMPANY_SIZES のどれか。空は "" */
    companySize: text("company_size").notNull().default(""),
    utmSource: text("utm_source").notNull().default(""),
    utmMedium: text("utm_medium").notNull().default(""),
    utmCampaign: text("utm_campaign").notNull().default(""),
    landingPath: text("landing_path").notNull().default("/"),
    consentTextVersion: bigint("consent_text_version", { mode: "number" }).notNull(),
    /** そのとき出していたプライバシーポリシーの版(LEGAL_VERSIONS。公開の版が無ければ空) */
    privacyVersion: bigint("privacy_version", { mode: "number" }),
    consentedAt: instant("consented_at").notNull().defaultNow(),
    /** 確認のメールを最後に積んだ時刻(同じアドレスへは24時間に1通。確認のリンクはこの時刻から作る) */
    confirmSentAt: instant("confirm_sent_at").notNull().defaultNow(),
    confirmedAt: instant("confirmed_at"),
    /** pending / confirmed / converted */
    status: text("status").notNull().default("pending"),
    convertedTenantId: uuid("converted_tenant_id"),
    convertedAt: instant("converted_at"),
    deleteAfter: dateOnly("delete_after").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("pre_registrations_email_key").on(t.tenantId, t.email),
    index("pre_registrations_delete_after_idx").on(t.tenantId, t.deleteAfter),
    index("pre_registrations_status_idx").on(t.tenantId, t.status, t.createdAt),
  ],
);

/** 日ごと・ページごと・来た所ごとの数(個人の行は持たない)。来るたびに足すだけで、行は組み合わせごとにしか増えない */
export const lpDailyCounts = growth.table(
  "lp_daily_counts",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    /** 日本時間の日付 */
    day: dateOnly("day").notNull(),
    path: text("path").notNull(),
    utmSource: text("utm_source").notNull(),
    utmMedium: text("utm_medium").notNull(),
    utmCampaign: text("utm_campaign").notNull(),
    views: bigint("views", { mode: "number" }).notNull().default(0),
    registrations: bigint("registrations", { mode: "number" }).notNull().default(0),
    confirmations: bigint("confirmations", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    primaryKey({
      name: "lp_daily_counts_pkey",
      columns: [t.tenantId, t.day, t.path, t.utmSource, t.utmMedium, t.utmCampaign],
    }),
  ],
);

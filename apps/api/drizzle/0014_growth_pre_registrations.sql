-- 長いロック待ちで本番を止めない(squawk: require-lock-timeout / require-statement-timeout)
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- 公開の LP の事前登録と日ごとの数(docs/specs/0025-public-landing-page.md・docs/designs/0025-public-landing-page.md の 2・ADR 0038)。
-- 危険度「高」(RLS と権限)。段: ① 拡張(新しいスキーマと表を足すだけ。前の版のアプリは読まないので、そのまま動く)。縮小は無い。
--
-- 1. 表は drizzle-kit が作った形(src/domains/growth/schema.ts)。どちらも運営の組織の tenant_id で持つ。新しい表なので索引はこの移行の中でよい(空)。
-- 2. アプリ(app_rw)は、事前登録を読む・足す・確認の列だけ直す・消す(本人の取り消し)。組織にした印(converted_*)は運営のコマンドだけ。
--    日ごとの数は読む・足す・数の列だけ直す(足し算)。古い行を消すのは運営のコマンド pre-registrations-purge(表の持ち主)。
-- 戻し方: DROP SCHEMA growth CASCADE;(前の版のアプリは読まないので、戻さなくても動く。事前登録が消えるので、戻すときは要るか確かめてから)
CREATE SCHEMA "growth";
--> statement-breakpoint
CREATE TABLE "growth"."lp_daily_counts" (
	"tenant_id" uuid NOT NULL,
	"day" date NOT NULL,
	"path" text NOT NULL,
	"utm_source" text NOT NULL,
	"utm_medium" text NOT NULL,
	"utm_campaign" text NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"registrations" integer DEFAULT 0 NOT NULL,
	"confirmations" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "lp_daily_counts_pkey" PRIMARY KEY("tenant_id","day","path","utm_source","utm_medium","utm_campaign")
);
--> statement-breakpoint
CREATE TABLE "growth"."pre_registrations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"organization_name" text NOT NULL,
	"company_size" text DEFAULT '' NOT NULL,
	"utm_source" text DEFAULT '' NOT NULL,
	"utm_medium" text DEFAULT '' NOT NULL,
	"utm_campaign" text DEFAULT '' NOT NULL,
	"landing_path" text DEFAULT '/' NOT NULL,
	"consent_text_version" integer NOT NULL,
	"privacy_version" integer,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirm_sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"converted_tenant_id" uuid,
	"converted_at" timestamp with time zone,
	"delete_after" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pre_registrations_email_key" UNIQUE("tenant_id","email")
);
--> statement-breakpoint
ALTER TABLE "growth"."lp_daily_counts" ADD CONSTRAINT "lp_daily_counts_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "organizations"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth"."pre_registrations" ADD CONSTRAINT "pre_registrations_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "organizations"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pre_registrations_delete_after_idx" ON "growth"."pre_registrations" USING btree ("tenant_id","delete_after");--> statement-breakpoint
CREATE INDEX "pre_registrations_status_idx" ON "growth"."pre_registrations" USING btree ("tenant_id","status","created_at");

--> statement-breakpoint
GRANT USAGE ON SCHEMA growth TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON growth.pre_registrations TO app_rw;
--> statement-breakpoint
GRANT UPDATE (confirm_sent_at, status, confirmed_at, delete_after) ON growth.pre_registrations TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT ON growth.lp_daily_counts TO app_rw;
--> statement-breakpoint
GRANT UPDATE (views, registrations, confirmations) ON growth.lp_daily_counts TO app_rw;
--> statement-breakpoint
ALTER TABLE growth.pre_registrations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE growth.pre_registrations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON growth.pre_registrations
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE growth.lp_daily_counts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE growth.lp_daily_counts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON growth.lp_daily_counts
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

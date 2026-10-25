-- 長いロック待ちで本番を止めない(squawk: require-lock-timeout / require-statement-timeout)
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- 大きなお客さん向けの守りの段1a: 会社のドメインと、組織に入れる IP の範囲(docs/specs/0056-sso-scim-ip-audit-export.md・
-- docs/designs/0056-sso-scim-ip-audit-export.md の 2・ADR 0067)。危険度「高」(RLS と権限)。段: ① 拡張(新しい表を足すだけ)。
--
-- 1. 表は drizzle-kit が作った形(src/domains/organizations/schema.ts)。確かめたドメインは全体で1つの組織だけ(一意の索引)。
-- 2. アプリ(app_rw)は自社のドメインを読む・足す・消す・確かめた時刻を書く。IP の範囲は読む・足す・消す(一覧ごと入れ替える)。
-- 戻し方: DROP TABLE organizations.ip_allowlist, organizations.domains;(前の版のアプリは読まないので、戻さなくても動く)
CREATE TABLE "organizations"."domains" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"verify_token" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "domains_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "organizations"."ip_allowlist" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cidr" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations"."domains" ADD CONSTRAINT "domains_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "organizations"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations"."domains" ADD CONSTRAINT "domains_created_by_fkey" FOREIGN KEY ("tenant_id","created_by") REFERENCES "organizations"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations"."ip_allowlist" ADD CONSTRAINT "ip_allowlist_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "organizations"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations"."ip_allowlist" ADD CONSTRAINT "ip_allowlist_created_by_fkey" FOREIGN KEY ("tenant_id","created_by") REFERENCES "organizations"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "domains_tenant_domain_key" ON "organizations"."domains" USING btree ("tenant_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "domains_verified_domain_key" ON "organizations"."domains" USING btree ("domain") WHERE verified_at is not null;--> statement-breakpoint
CREATE INDEX "ip_allowlist_tenant_idx" ON "organizations"."ip_allowlist" USING btree ("tenant_id");--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON organizations.domains TO app_rw;
--> statement-breakpoint
GRANT UPDATE (verified_at) ON organizations.domains TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON organizations.ip_allowlist TO app_rw;
--> statement-breakpoint
ALTER TABLE organizations.domains ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organizations.domains FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON organizations.domains
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE organizations.ip_allowlist ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organizations.ip_allowlist FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON organizations.ip_allowlist
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

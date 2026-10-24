-- 長いロック待ちで本番を止めない(squawk: require-lock-timeout / require-statement-timeout)
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- 組織ごとの機能フラグ(docs/specs/0012-feature-flags-and-usage.md・docs/designs/0012-feature-flags-and-usage.md の 2・ADR 0025)。
-- 危険度「高」(RLS と権限)。段: ① 拡張(新しい表を足すだけ。前の版のアプリは読まないので、そのまま動く)。縮小は無い。
--
-- 1. 表は drizzle-kit が作った形(src/feature-flags/schema.ts)。行がある = その組織に機能を入れた。
-- 2. アプリ(app_rw)は**読むだけ**。入れる・切るのは運営のコマンド feature-flag(この移行を流した接続 = 表の持ち主)だけ。
-- 戻し方: DROP TABLE platform.feature_flags;(前の版のアプリは読まないので、戻さなくても動く)
CREATE TABLE "platform"."feature_flags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"flag" text NOT NULL,
	"enabled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flags_tenant_flag_key" UNIQUE("tenant_id","flag")
);
--> statement-breakpoint
ALTER TABLE "platform"."feature_flags" ADD CONSTRAINT "feature_flags_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "organizations"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
GRANT SELECT ON platform.feature_flags TO app_rw;
--> statement-breakpoint
ALTER TABLE platform.feature_flags ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform.feature_flags FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON platform.feature_flags
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

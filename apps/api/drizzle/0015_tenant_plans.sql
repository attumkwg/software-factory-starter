-- 長いロック待ちで本番を止めない(squawk: require-lock-timeout / require-statement-timeout)
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- 組織の契約のプラン(docs/specs/0047-plans.md・docs/designs/0047-plans.md の 2・ADR 0058)。
-- 危険度「高」(RLS と権限)。段: ① 拡張(新しい表を足すだけ。前の版のアプリは読まないので、そのまま動く)。縮小は無い。
--
-- 1. 表は drizzle-kit が作った形(src/plans/schema.ts)。足すだけ(変えるたびに1行)。人数は1以上(上限なしは NULL)。
-- 2. アプリ(app_rw)は**読むだけ**。書くのは運営のコマンド plan・create-tenant(この移行を流した接続 = 表の持ち主)だけ。
-- 戻し方: DROP TABLE platform.tenant_plans;(前の版のアプリは読まないので、戻さなくても動く)
CREATE TABLE "platform"."tenant_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan" text NOT NULL,
	"price_list" text NOT NULL,
	-- 人数の上限は数千人まで(int で足りる。数を数える列ではない)
	-- squawk-ignore prefer-bigint-over-int
	"seats" integer,
	"price_locked_until" date,
	"effective_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform"."tenant_plans" ADD CONSTRAINT "tenant_plans_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "organizations"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_plans_current_idx" ON "platform"."tenant_plans" USING btree ("tenant_id","effective_on" DESC NULLS LAST,"created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE platform.tenant_plans ADD CONSTRAINT tenant_plans_seats_positive CHECK (seats IS NULL OR seats > 0);
--> statement-breakpoint
GRANT SELECT ON platform.tenant_plans TO app_rw;
--> statement-breakpoint
ALTER TABLE platform.tenant_plans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform.tenant_plans FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON platform.tenant_plans
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

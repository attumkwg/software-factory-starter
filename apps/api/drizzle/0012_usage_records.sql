-- 長いロック待ちで本番を止めない(squawk: require-lock-timeout / require-statement-timeout)
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- 利用の記録(docs/specs/0012-feature-flags-and-usage.md・docs/designs/0012-feature-flags-and-usage.md の 2・ADR 0025)。
-- 危険度「高」(RLS と権限)。段: ① 拡張(新しい表と関数を足すだけ。前の版のアプリは読まないので、そのまま動く)。縮小は無い。
--
-- 1. 表は drizzle-kit が作った形(src/usage/schema.ts)。1日1人1機能1行。新しい表なので索引はこの移行の中でよい(空)。
-- 2. アプリ(app_rw)は**読む・足すだけ**(直す・消すは無い)。消すのは運営のコマンド usage-purge と解約のコマンド(表の持ち主)。
-- 3. 集計・削除のコマンドが組織の一覧を引くための関数 operator_tenant_ids(組織の ID だけを返す)。
--    0010 の legal_notice_tenants と同じ形(app_auth の権限で動き、呼べるのは移行の持ち主 = コマンドの接続だけ)。
--    規約の部品を消しても残るよう、ポリシーは別の名前で持つ。
-- 戻し方: DROP FUNCTION public.operator_tenant_ids(); DROP POLICY operator_tenants ON organizations.tenants;
--         DROP TABLE platform.feature_usage;
--         (前の版のアプリはこれらを読まないので、戻さなくても動く。DROP TABLE は記録を消す)
CREATE TABLE "platform"."feature_usage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"day" date NOT NULL,
	CONSTRAINT "feature_usage_once_a_day_key" UNIQUE("tenant_id","user_id","feature","day")
);
--> statement-breakpoint
ALTER TABLE "platform"."feature_usage" ADD CONSTRAINT "feature_usage_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "organizations"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."feature_usage" ADD CONSTRAINT "feature_usage_user_fkey" FOREIGN KEY ("tenant_id","user_id") REFERENCES "organizations"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feature_usage_feature_day_idx" ON "platform"."feature_usage" USING btree ("tenant_id","feature","day");
--> statement-breakpoint
GRANT SELECT, INSERT ON platform.feature_usage TO app_rw;
--> statement-breakpoint
ALTER TABLE platform.feature_usage ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform.feature_usage FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON platform.feature_usage
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- コマンドだけが、組織の ID の一覧を引ける(名前などほかの列は読めない)
GRANT SELECT (tenant_id) ON organizations.tenants TO app_auth;
--> statement-breakpoint
CREATE POLICY operator_tenants ON organizations.tenants FOR SELECT TO app_auth USING (true);
--> statement-breakpoint
CREATE FUNCTION public.operator_tenant_ids()
  RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = organizations, pg_temp
  AS $$ SELECT t.tenant_id FROM tenants t $$;
--> statement-breakpoint
-- 持ち主を移すには移り先に CREATE が要るので、その間だけ渡してすぐ取り上げる(0001 と同じ)
GRANT CREATE ON SCHEMA public TO app_auth;
--> statement-breakpoint
ALTER FUNCTION public.operator_tenant_ids() OWNER TO app_auth;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM app_auth;
--> statement-breakpoint
-- アプリ(app_rw)には渡さない。呼べるのは移行の持ち主(この移行を流した接続 = コマンドの接続)だけ
REVOKE ALL ON FUNCTION public.operator_tenant_ids() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.operator_tenant_ids() TO CURRENT_USER;

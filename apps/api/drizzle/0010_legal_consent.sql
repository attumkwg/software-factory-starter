-- 長いロック待ちで本番を止めない(squawk: require-lock-timeout / require-statement-timeout)
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- 利用規約・プライバシーポリシーの同意(docs/specs/0009-legal-consent.md・docs/designs/0009-legal-consent.md の 2・ADR 0019)。
-- 危険度「高」(RLS と権限)。段: ① 拡張(新しいスキーマと表を足すだけ。前の版のアプリは読まないので、そのまま動く)。縮小は無い。
--
-- 1. 表は drizzle-kit が作った形(src/domains/legal/schema.ts)。
-- 2. アプリ(app_rw)は同意の記録を**読む・足すだけ**(直す・消すは無い)。お知らせの記録は読むだけ(足すのは運営のコマンド)。
--    消すのは解約のコマンド(表の持ち主)だけ。
-- 3. お知らせのコマンドが組織の一覧を引くための関数 legal_notice_tenants(組織の ID だけを返す)。
--    0001 の auth_find_user_by_email と同じ app_auth の権限で動く。実行できるのは移行の持ち主(コマンドの接続)だけ。
-- 戻し方: DROP FUNCTION public.legal_notice_tenants(); DROP POLICY legal_notice ON organizations.tenants;
--         REVOKE SELECT (tenant_id) ON organizations.tenants FROM app_auth; DROP SCHEMA legal CASCADE;
--         (前の版のアプリはこれらを読まないので、戻さなくても動く。DROP SCHEMA は同意の記録を消すので、戻すときは書き出してから)
CREATE SCHEMA "legal";
--> statement-breakpoint
CREATE TABLE "legal"."consents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"document" text NOT NULL,
	"version" bigint NOT NULL,
	"capacity" text NOT NULL,
	"source" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consents_user_version_key" UNIQUE("tenant_id","user_id","document","version")
);
--> statement-breakpoint
CREATE TABLE "legal"."notices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"document" text NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notices_user_version_key" UNIQUE("tenant_id","user_id","document","version")
);
--> statement-breakpoint
ALTER TABLE "legal"."consents" ADD CONSTRAINT "consents_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "organizations"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal"."consents" ADD CONSTRAINT "consents_user_fkey" FOREIGN KEY ("tenant_id","user_id") REFERENCES "organizations"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal"."notices" ADD CONSTRAINT "notices_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "organizations"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal"."notices" ADD CONSTRAINT "notices_user_fkey" FOREIGN KEY ("tenant_id","user_id") REFERENCES "organizations"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
GRANT USAGE ON SCHEMA legal TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT ON legal.consents TO app_rw;
--> statement-breakpoint
GRANT SELECT ON legal.notices TO app_rw;
--> statement-breakpoint
ALTER TABLE legal.consents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE legal.consents FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON legal.consents
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE legal.notices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE legal.notices FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON legal.notices
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- お知らせのコマンドだけが、組織の ID の一覧を引ける(名前などほかの列は読めない)
GRANT SELECT (tenant_id) ON organizations.tenants TO app_auth;
--> statement-breakpoint
CREATE POLICY legal_notice ON organizations.tenants FOR SELECT TO app_auth USING (true);
--> statement-breakpoint
CREATE FUNCTION public.legal_notice_tenants()
  RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = organizations, pg_temp
  AS $$ SELECT t.tenant_id FROM tenants t $$;
--> statement-breakpoint
-- 持ち主を移すには移り先に CREATE が要るので、その間だけ渡してすぐ取り上げる(0001 と同じ)
GRANT CREATE ON SCHEMA public TO app_auth;
--> statement-breakpoint
ALTER FUNCTION public.legal_notice_tenants() OWNER TO app_auth;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM app_auth;
--> statement-breakpoint
-- アプリ(app_rw)には渡さない。呼べるのは移行の持ち主(この移行を流した接続 = コマンドの接続)だけ
REVOKE ALL ON FUNCTION public.legal_notice_tenants() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.legal_notice_tenants() TO CURRENT_USER;

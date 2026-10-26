-- 長いロック待ちで本番を止めない(squawk: require-lock-timeout / require-statement-timeout)
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- 大きなお客さん向けの守りの段1b: SSO(SAML)のつなぎ・必須・緊急用(docs/specs/0056-sso-scim-ip-audit-export.md・
-- docs/designs/0056-sso-scim-ip-audit-export.md の 2・ADR 0067)。危険度「高」(RLS・認証の関数・権限)。段: ① 拡張(足すだけ)。
--
-- 1. organizations.sso_connections(組織につないだ IdP。1組織に1つ・1つの IdP は1つの組織だけ)。行を足す・消すのは
--    運営のコマンド(sso-connect。表の持ち主)。アプリ(app_rw)は読むのと、必須の入切(required・updated_at)だけ。
-- 2. users.sso_exempt(緊急用のアカウント)。アプリが書ける。定数の既定値の ADD COLUMN は表を書き直さない(PG 11 から)。
-- 3. 組織が決まる前に引く関数(0001 の auth_find_user_by_email と同じ app_auth の権限。行そのものは返さない):
--    auth_find_sso_by_domain(ドメイン) … 確かめたドメインに IdP をつないだ組織があれば、IdP の名前だけ(組織の ID は返さない)
--    auth_find_sso_member(IdP の名前, メール) … その IdP の組織で・メールのドメインがその組織の確かめたドメインで・
--      その組織にそのメールの行があるときだけ、所属の ID と組織の ID。Cognito の sub では結びつけない(設計書 0056 の 13)
-- 戻し方: DROP FUNCTION auth_find_sso_by_domain(text), auth_find_sso_member(text, text);
--         DROP POLICY sso_lookup ON organizations.sso_connections; DROP POLICY sso_lookup ON organizations.domains;
--         DROP TABLE organizations.sso_connections; ALTER TABLE organizations.users DROP COLUMN sso_exempt;
--         (前の版のアプリは使わないので、戻さなくても動く)
CREATE TABLE "organizations"."sso_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider_name" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "organizations"."users" ADD COLUMN "sso_exempt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations"."sso_connections" ADD CONSTRAINT "sso_connections_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "organizations"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sso_connections_tenant_key" ON "organizations"."sso_connections" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sso_connections_provider_key" ON "organizations"."sso_connections" USING btree ("provider_name");
--> statement-breakpoint
GRANT SELECT ON organizations.sso_connections TO app_rw;
--> statement-breakpoint
GRANT UPDATE (required, updated_at) ON organizations.sso_connections TO app_rw;
--> statement-breakpoint
GRANT UPDATE (sso_exempt) ON organizations.users TO app_rw;
--> statement-breakpoint
ALTER TABLE organizations.sso_connections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organizations.sso_connections FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON organizations.sso_connections
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- ── 組織が決まる前に引く(app_auth) ──
GRANT SELECT (tenant_id, provider_name) ON organizations.sso_connections TO app_auth;
--> statement-breakpoint
CREATE POLICY sso_lookup ON organizations.sso_connections FOR SELECT TO app_auth USING (true);
--> statement-breakpoint
GRANT SELECT (tenant_id, domain, verified_at) ON organizations.domains TO app_auth;
--> statement-breakpoint
CREATE POLICY sso_lookup ON organizations.domains FOR SELECT TO app_auth USING (verified_at IS NOT NULL);
--> statement-breakpoint
CREATE FUNCTION public.auth_find_sso_by_domain(p_domain text)
  RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = organizations, pg_temp
  AS $$
    SELECT s.provider_name
      FROM domains d JOIN sso_connections s ON s.tenant_id = d.tenant_id
     WHERE d.domain = lower(p_domain) AND d.verified_at IS NOT NULL
  $$;
--> statement-breakpoint
CREATE FUNCTION public.auth_find_sso_member(p_provider_name text, p_email text)
  RETURNS TABLE (user_id uuid, tenant_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = organizations, pg_temp
  AS $$
    SELECT u.id, u.tenant_id
      FROM sso_connections s
      JOIN domains d ON d.tenant_id = s.tenant_id AND d.verified_at IS NOT NULL
                    AND d.domain = split_part(lower(p_email), '@', 2)
      JOIN users u ON u.tenant_id = s.tenant_id AND u.email = lower(p_email)
     WHERE s.provider_name = p_provider_name AND position('@' in p_email) > 1
  $$;
--> statement-breakpoint
-- 持ち主を移すには移り先に CREATE が要るので、その間だけ渡してすぐ取り上げる(0001 と同じ)
GRANT CREATE ON SCHEMA public TO app_auth;
--> statement-breakpoint
ALTER FUNCTION public.auth_find_sso_by_domain(text) OWNER TO app_auth;
--> statement-breakpoint
ALTER FUNCTION public.auth_find_sso_member(text, text) OWNER TO app_auth;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM app_auth;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.auth_find_sso_by_domain(text), public.auth_find_sso_member(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.auth_find_sso_by_domain(text), public.auth_find_sso_member(text, text) TO app_rw;

-- 長いロック待ちで本番を止めない(squawk: require-lock-timeout / require-statement-timeout)
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- サポートの代理ログイン(docs/specs/0004-support-access.md・ADR 0014)。この移行は危険度「高」(RLS と権限)。
--
-- 1. 表は drizzle-kit が作った形(src/domains/organizations/schema.ts)。
-- 2. アプリ(app_rw)は自社の許可と入室を読み書きする(取り消し・終わりの時刻だけ直せる。消せない)。
-- 3. 社員がサポート番号から許可を探すのは、support_find_grant の関数だけ(app_support の権限で、
--    全社分の許可を「番号のハッシュで1件」だけ引ける)。0001 の app_auth と同じ形。
CREATE TABLE "organizations"."support_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"granted_by" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "support_grants_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "organizations"."support_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"staff_name" text NOT NULL,
	"staff_email" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "organizations"."support_grants" ADD CONSTRAINT "support_grants_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "organizations"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations"."support_grants" ADD CONSTRAINT "support_grants_granted_by_fkey" FOREIGN KEY ("tenant_id","granted_by") REFERENCES "organizations"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations"."support_sessions" ADD CONSTRAINT "support_sessions_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "organizations"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations"."support_sessions" ADD CONSTRAINT "support_sessions_grant_fkey" FOREIGN KEY ("tenant_id","grant_id") REFERENCES "organizations"."support_grants"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "support_grants_code_hash_key" ON "organizations"."support_grants" USING btree ("code_hash");

--> statement-breakpoint
GRANT SELECT, INSERT ON organizations.support_grants TO app_rw;
--> statement-breakpoint
GRANT UPDATE (revoked_at, revoked_by) ON organizations.support_grants TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT ON organizations.support_sessions TO app_rw;
--> statement-breakpoint
GRANT UPDATE (ended_at) ON organizations.support_sessions TO app_rw;
--> statement-breakpoint
ALTER TABLE organizations.support_grants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organizations.support_grants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON organizations.support_grants
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE organizations.support_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organizations.support_sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON organizations.support_sessions
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_support') THEN
    CREATE ROLE app_support NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT app_support TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA organizations TO app_support;
--> statement-breakpoint
GRANT SELECT (id, tenant_id, code_hash, expires_at, revoked_at) ON organizations.support_grants TO app_support;
--> statement-breakpoint
CREATE POLICY support_lookup ON organizations.support_grants FOR SELECT TO app_support USING (true);
--> statement-breakpoint
-- 番号のハッシュで、生きている許可を1件だけ返す(期限内・取り消されていない)
CREATE FUNCTION support_find_grant(p_code_hash text)
  RETURNS TABLE (grant_id uuid, tenant_id uuid, expires_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = organizations, pg_temp
  AS $$
    SELECT g.id, g.tenant_id, g.expires_at FROM support_grants g
     WHERE g.code_hash = p_code_hash AND g.revoked_at IS NULL AND g.expires_at > now()
  $$;
--> statement-breakpoint
-- 持ち主を移すには移り先に CREATE が要るので、その間だけ渡してすぐ取り上げる(0001 と同じ)
GRANT CREATE ON SCHEMA public TO app_support;
--> statement-breakpoint
ALTER FUNCTION support_find_grant(text) OWNER TO app_support;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM app_support;
--> statement-breakpoint
REVOKE ALL ON FUNCTION support_find_grant(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION support_find_grant(text) TO app_rw;

-- 長いロック待ちで本番を止めない(squawk: require-lock-timeout / require-statement-timeout)
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- テナント分離の最後の砦(docs/adr/0001-shared-tables-with-rls.md)。この移行は危険度「高」。
--
-- 1. アプリの接続ユーザーは「表の持ち主ではない」ロール app_rw に入れる(持ち主は RLS をすり抜けうる)。
-- 2. 全テーブルで RLS を有効にし、FORCE で持ち主にも効かせる。
-- 3. テナントはトランザクションごとに set_config('app.tenant_id', ..., true)(= SET LOCAL)で渡す。
--    渡していなければ app_current_tenant() は NULL になり、どの行も見えない・書けない。

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_auth') THEN
    CREATE ROLE app_auth NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_rw;
--> statement-breakpoint
-- 必要な操作だけを渡す(組織とユーザーはアプリからは読むだけ)
GRANT SELECT ON tenants, users TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON projects, tasks TO app_rw;
--> statement-breakpoint
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tenants
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE users FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON projects
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tasks
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- ログインのときだけは、テナントが決まる前に「このメール(外部 ID)は誰か」を引く必要がある。
-- そのための穴を「users を読むだけ・決まった2列を返すだけ」の関数に閉じ込める。
-- 関数は app_auth の権限で動き、app_auth には users を全社分読むポリシーだけを付ける。
GRANT app_auth TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_auth;
--> statement-breakpoint
GRANT SELECT (id, tenant_id, email, external_id) ON users TO app_auth;
--> statement-breakpoint
CREATE POLICY login_lookup ON users FOR SELECT TO app_auth USING (true);
--> statement-breakpoint
CREATE FUNCTION auth_find_user_by_email(p_email text)
  RETURNS TABLE (user_id uuid, tenant_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$ SELECT u.id, u.tenant_id FROM users u WHERE u.email = lower(p_email) $$;
--> statement-breakpoint
CREATE FUNCTION auth_find_user_by_external_id(p_external_id text)
  RETURNS TABLE (user_id uuid, tenant_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$ SELECT u.id, u.tenant_id FROM users u WHERE u.external_id = p_external_id $$;
--> statement-breakpoint
-- 持ち主を移すには移り先に CREATE が要るので、その間だけ渡してすぐ取り上げる
GRANT CREATE ON SCHEMA public TO app_auth;
--> statement-breakpoint
ALTER FUNCTION auth_find_user_by_email(text) OWNER TO app_auth;
--> statement-breakpoint
ALTER FUNCTION auth_find_user_by_external_id(text) OWNER TO app_auth;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM app_auth;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_find_user_by_email(text), auth_find_user_by_external_id(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_find_user_by_email(text), auth_find_user_by_external_id(text) TO app_rw;

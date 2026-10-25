-- 長いロック待ちで本番を止めない(squawk: require-lock-timeout / require-statement-timeout)
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- 1人が複数の組織に所属する形の段 ①(拡張)(docs/specs/0055-multi-org-membership.md・docs/designs/0055-multi-org-membership.md の 2・ADR 0066)。
-- 危険度「高」(認証の関数と権限)。前の版のアプリは新しい列も関数も使わないので、そのまま動く。
--
-- 1. users.last_used_at(その組織に最後に入った時刻)。アプリ(app_rw)が書ける。NULL 可の ADD COLUMN は表を書き直さない。
-- 2. 組織ごとの一意の索引(tenant_id, email)・(tenant_id, external_id)は drizzle/concurrent/0018_multi_org_keys.sql で
--    CONCURRENTLY に作る(すでにある表なので)。全体の一意(users_email_key・users_external_id_key)は段 ③ まで残す。
-- 3. 組織が決まる前に、その人の所属の一覧を引く関数 auth_find_memberships(0001 の auth_find_user_by_* と同じ app_auth の権限)。
--    返すのは所属の ID・組織の ID と名前・ロール・最後に入った時刻・作った時刻だけ。
-- 4. 人に1つの物(メール・二段階認証の写し・ほかの端末を切った時刻)を、同じ人(Cognito の sub)の全部の所属にそろえる
--    関数 auth_sync_person。app_auth に許すのは、その3列の UPDATE だけ(sub で結びついた行だけ)。
-- 5. その人(sub)の所属の数を数える関数 auth_count_memberships(解約・1人分の削除で、Cognito から消してよいか)。
--    運営のコマンドは表の持ち主で流すので、持ち主にも呼べるようにする。
-- 戻し方: DROP FUNCTION auth_find_memberships(text, text), auth_sync_person(text, text, boolean, timestamptz),
--         auth_count_memberships(text); DROP POLICY person_sync ON organizations.users; DROP POLICY membership_lookup ON organizations.tenants;
--         REVOKE UPDATE (email, mfa_enabled, sessions_valid_after) ON organizations.users FROM app_auth;
--         ALTER TABLE organizations.users DROP COLUMN last_used_at;(前の版のアプリは使わないので、戻さなくても動く)
ALTER TABLE "organizations"."users" ADD COLUMN "last_used_at" timestamp with time zone;
--> statement-breakpoint
GRANT UPDATE (last_used_at) ON organizations.users TO app_rw;
--> statement-breakpoint
-- ── 所属の一覧(app_auth) ──
GRANT SELECT (name, role, last_used_at, created_at, mfa_enabled, sessions_valid_after) ON organizations.users TO app_auth;
--> statement-breakpoint
GRANT SELECT (tenant_id, name) ON organizations.tenants TO app_auth;
--> statement-breakpoint
CREATE POLICY membership_lookup ON organizations.tenants FOR SELECT TO app_auth USING (true);
--> statement-breakpoint
-- sub があれば sub で、無ければ(開発用ログイン)メールで。前回入った組織が先・次に古い所属。1人 50 まで(設計書 0055 の U-4)
CREATE FUNCTION public.auth_find_memberships(p_external_id text, p_email text)
  RETURNS TABLE (user_id uuid, tenant_id uuid, tenant_name text, role organizations.role, last_used_at timestamptz, created_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = organizations, pg_temp
  AS $$
    SELECT u.id, u.tenant_id, t.name, u.role, u.last_used_at, u.created_at
      FROM users u JOIN tenants t ON t.tenant_id = u.tenant_id
     WHERE (p_external_id IS NOT NULL AND u.external_id = p_external_id)
        OR (p_external_id IS NULL AND u.email = lower(p_email))
     ORDER BY u.last_used_at DESC NULLS LAST, u.created_at, u.id
     LIMIT 50
  $$;
--> statement-breakpoint
-- ── 人に1つの物を、全部の所属にそろえる(app_auth) ──
GRANT UPDATE (email, mfa_enabled, sessions_valid_after) ON organizations.users TO app_auth;
--> statement-breakpoint
CREATE POLICY person_sync ON organizations.users FOR UPDATE TO app_auth
  USING (external_id IS NOT NULL)
  WITH CHECK (external_id IS NOT NULL);
--> statement-breakpoint
-- NULL を渡した項目は変えない。ほかの端末を切った時刻は、新しい方だけを書く(古い時刻で上書きしない)
CREATE FUNCTION public.auth_sync_person(p_external_id text, p_email text, p_mfa_enabled boolean, p_sessions_valid_after timestamptz)
  RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = organizations, pg_temp
  AS $$
    WITH changed AS (
      UPDATE users u SET
        email = coalesce(lower(p_email), u.email),
        mfa_enabled = coalesce(p_mfa_enabled, u.mfa_enabled),
        sessions_valid_after = CASE
          WHEN p_sessions_valid_after IS NULL THEN u.sessions_valid_after
          WHEN u.sessions_valid_after IS NULL OR u.sessions_valid_after < p_sessions_valid_after THEN p_sessions_valid_after
          ELSE u.sessions_valid_after END
      WHERE p_external_id IS NOT NULL AND u.external_id = p_external_id
      RETURNING 1
    )
    SELECT count(*)::integer FROM changed
  $$;
--> statement-breakpoint
CREATE FUNCTION public.auth_count_memberships(p_external_id text)
  RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = organizations, pg_temp
  AS $$ SELECT count(*)::integer FROM users u WHERE u.external_id = p_external_id $$;
--> statement-breakpoint
-- 持ち主を移すには移り先に CREATE が要るので、その間だけ渡してすぐ取り上げる(0001 と同じ)
GRANT CREATE ON SCHEMA public TO app_auth;
--> statement-breakpoint
ALTER FUNCTION public.auth_find_memberships(text, text) OWNER TO app_auth;
--> statement-breakpoint
ALTER FUNCTION public.auth_sync_person(text, text, boolean, timestamptz) OWNER TO app_auth;
--> statement-breakpoint
ALTER FUNCTION public.auth_count_memberships(text) OWNER TO app_auth;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM app_auth;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.auth_find_memberships(text, text), public.auth_sync_person(text, text, boolean, timestamptz), public.auth_count_memberships(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.auth_find_memberships(text, text), public.auth_sync_person(text, text, boolean, timestamptz), public.auth_count_memberships(text) TO app_rw;
--> statement-breakpoint
-- 運営のコマンド(delete-tenant・person-data)は表の持ち主で流すので、数える関数だけは持ち主にも
GRANT EXECUTE ON FUNCTION public.auth_count_memberships(text) TO CURRENT_USER;

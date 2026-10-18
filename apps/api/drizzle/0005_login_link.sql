-- 長いロック待ちで本番を止めない(squawk: require-lock-timeout / require-statement-timeout)
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- 初めて Cognito でログインした人を、users の行と結びつける(external_id を埋める)。この移行は危険度「高」。
--
-- 「誰でも Cognito に登録できる・アプリに入れるのは users にいる人だけ」の決まり(docs/security.md)。
-- 管理者が users に行(メールアドレス)を作っておき、その人が Cognito で確認済みのメールでログインしたら結びつける。
--
-- 0001_rls.sql と同じく、穴は「決まった1列を、まだ空のときだけ埋める」関数に閉じ込める。
--   - app_auth に許すのは external_id の UPDATE だけ(列の権限)
--   - ポリシーで「まだ誰とも結びついていない行」だけに絞る(結びついた行は、つけ替えられない)
--   - 呼べるのはアプリの接続ユーザー(app_rw)だけ
-- 戻し方: DROP FUNCTION auth_link_external_id(text, text); DROP POLICY login_link ON organizations.users;
--         REVOKE UPDATE (external_id) ON organizations.users FROM app_auth;
GRANT UPDATE (external_id) ON organizations.users TO app_auth;
--> statement-breakpoint
CREATE POLICY login_link ON organizations.users FOR UPDATE TO app_auth
  USING (external_id IS NULL)
  WITH CHECK (external_id IS NOT NULL);
--> statement-breakpoint
CREATE FUNCTION public.auth_link_external_id(p_email text, p_external_id text)
  RETURNS TABLE (user_id uuid, tenant_id uuid)
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = organizations, pg_temp
  AS $$
    UPDATE users u SET external_id = p_external_id
    WHERE u.email = lower(p_email) AND u.external_id IS NULL
    RETURNING u.id, u.tenant_id
  $$;
--> statement-breakpoint
-- 持ち主を移すには移り先に CREATE が要るので、その間だけ渡してすぐ取り上げる(0001 と同じ)
GRANT CREATE ON SCHEMA public TO app_auth;
--> statement-breakpoint
ALTER FUNCTION public.auth_link_external_id(text, text) OWNER TO app_auth;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM app_auth;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.auth_link_external_id(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.auth_link_external_id(text, text) TO app_rw;

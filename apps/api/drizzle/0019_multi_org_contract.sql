-- 長いロック待ちで本番を止めない(squawk: require-lock-timeout / require-statement-timeout)
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- 1人が複数の組織に所属する形の段 ③(縮小)(docs/designs/0055-multi-org-membership.md の 2・ADR 0066)。危険度「高」・**戻せない**
-- (2つ目の所属ができた後は、全体の一意を張り直せない。設計書の U-3。段 ①② を出して1週間見てから)。
--
-- 1. 全体で一意の索引(users_email_key・users_external_id_key)は drizzle/concurrent/0019_drop_global_user_keys.sql で
--    CONCURRENTLY に消す。組織ごとの一意(0018)は残る。
-- 2. 「そのメールアドレスはほかの人が使っているか」(メールの変更)を、ほかの人(別の sub・sub の無い別の行)に変える。
--    同じ人のほかの所属は、同じメールを持っていてよい(変えると一緒に変わる)。
-- 3. 開通のコマンド(表の持ち主)が、最初の管理者のメールがほかの組織に所属しているかを数える関数(設計書の U-5)。
-- 戻し方: 2・3 は前の定義に戻せる。1 は戻せない(同じ人の行が2つの組織にあると、全体の一意を張れない)。
CREATE OR REPLACE FUNCTION public.auth_email_in_use(p_email text, p_user_id uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = organizations, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM users u
       WHERE u.email = lower(p_email) AND u.id <> p_user_id
         AND (u.external_id IS NULL
              OR u.external_id IS DISTINCT FROM (SELECT me.external_id FROM users me WHERE me.id = p_user_id))
    )
  $$;
--> statement-breakpoint
CREATE FUNCTION public.auth_count_memberships_by_email(p_email text)
  RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = organizations, pg_temp
  AS $$ SELECT count(*)::integer FROM users u WHERE u.email = lower(p_email) $$;
--> statement-breakpoint
-- 持ち主を移すには移り先に CREATE が要るので、その間だけ渡してすぐ取り上げる(0001 と同じ)
GRANT CREATE ON SCHEMA public TO app_auth;
--> statement-breakpoint
ALTER FUNCTION public.auth_count_memberships_by_email(text) OWNER TO app_auth;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM app_auth;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.auth_count_memberships_by_email(text) FROM PUBLIC;
--> statement-breakpoint
-- 開通のコマンドは表の持ち主で流す
GRANT EXECUTE ON FUNCTION public.auth_count_memberships_by_email(text) TO CURRENT_USER;

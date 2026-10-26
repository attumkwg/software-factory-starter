-- 長いロック待ちで本番を止めない(squawk: require-lock-timeout / require-statement-timeout)
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- 大きなお客さん向けの守りの段2: SCIM(情シスの道具が人を作る・止める。docs/specs/0056-sso-scim-ip-audit-export.md・
-- docs/designs/0056-sso-scim-ip-audit-export.md の 2・6)。危険度「高」(RLS・認証の関数・権限)。段: ① 拡張(足すだけ)。
--
-- 1. organizations.scim_tokens(SCIM の鍵。ハッシュだけ)。管理者(app_rw)が作る・取り消す。使った時刻はアプリが書く。
-- 2. users.disabled_at(SCIM で止めた時刻)・users.scim_external_id(道具の側の ID)。アプリが書ける。
--    NULL 可の ADD COLUMN は表を書き直さない。名前(name)も SCIM で直すので、アプリに UPDATE を渡す。
-- 3. 組織が決まる前に引く関数(0001 の auth_find_user_by_email と同じ app_auth の権限):
--    auth_find_scim_token(ハッシュ) … 取り消していない鍵の ID と組織の ID だけ
-- 4. 人を足す関数 scim_create_user(0014 の auth_accept_invitation と同じ形。ADR 0040「人を足すのは関数だけ」)。
--    いまの組織の文脈(app.tenant_id)の中でだけ・ロールは member・メールはその組織の確かめたドメインだけ。
--    確かめは関数の中で(行の方針に置くと、組織の文脈の中では tenant_isolation の許しと「または」になって効かない)。
-- 5. 監査ログの行為者の種類に scim(情シスの道具。actor_id は鍵の ID)。古い制約は消して、NOT VALID で足し直す
--    (新しい行には効く。今ある行は全部 3つのどれかなので確かめなくても同じ。大きな表を同じトランザクションで
--    確かめると読みが止まるので、VALIDATE は次の移行で1文だけ流す)。
-- 6. 止めた人はログインの所属に出さない(auth_find_memberships・auth_find_sso_member を同じ形で作り直す。関所は findAccess で見る)。
-- 戻し方: DROP FUNCTION auth_find_scim_token(text), scim_create_user(uuid, uuid, text, text, text);
--         REVOKE INSERT (scim_external_id) ON organizations.users FROM app_auth;
--         auth_find_memberships・auth_find_sso_member は 0018・0021 の形で作り直す;
--         (scim の監査ログの行があれば先に始末してから)audit_events_actor_kind_check を3つに戻す; DROP TABLE organizations.scim_tokens;
--         ALTER TABLE organizations.users DROP COLUMN disabled_at, DROP COLUMN scim_external_id;
--         (前の版のアプリは新しい列も関数も使わない。ただし止めた人が入れるようになるので、止めた人がいれば戻さない)
CREATE TABLE "organizations"."scim_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "scim_tokens_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "organizations"."users" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations"."users" ADD COLUMN "scim_external_id" text;--> statement-breakpoint
ALTER TABLE "organizations"."scim_tokens" ADD CONSTRAINT "scim_tokens_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "organizations"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations"."scim_tokens" ADD CONSTRAINT "scim_tokens_created_by_fkey" FOREIGN KEY ("tenant_id","created_by") REFERENCES "organizations"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations"."scim_tokens" ADD CONSTRAINT "scim_tokens_revoked_by_fkey" FOREIGN KEY ("tenant_id","revoked_by") REFERENCES "organizations"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scim_tokens_token_hash_key" ON "organizations"."scim_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "scim_tokens_tenant_idx" ON "organizations"."scim_tokens" USING btree ("tenant_id");
--> statement-breakpoint
GRANT SELECT, INSERT ON organizations.scim_tokens TO app_rw;
--> statement-breakpoint
GRANT UPDATE (last_used_at, revoked_at, revoked_by) ON organizations.scim_tokens TO app_rw;
--> statement-breakpoint
GRANT UPDATE (name, disabled_at, scim_external_id) ON organizations.users TO app_rw;
--> statement-breakpoint
ALTER TABLE organizations.scim_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organizations.scim_tokens FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON organizations.scim_tokens
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- ── 鍵から組織を引く(app_auth) ──
GRANT SELECT (id, tenant_id, token_hash, revoked_at) ON organizations.scim_tokens TO app_auth;
--> statement-breakpoint
CREATE POLICY scim_lookup ON organizations.scim_tokens FOR SELECT TO app_auth USING (revoked_at IS NULL);
--> statement-breakpoint
CREATE FUNCTION public.auth_find_scim_token(p_hash text)
  RETURNS TABLE (token_id uuid, tenant_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = organizations, pg_temp
  AS $$
    SELECT k.id, k.tenant_id FROM scim_tokens k WHERE k.token_hash = p_hash AND k.revoked_at IS NULL
  $$;
--> statement-breakpoint
-- ── SCIM で人を足す(app_auth) ──
GRANT INSERT (scim_external_id) ON organizations.users TO app_auth;
--> statement-breakpoint
GRANT SELECT (disabled_at) ON organizations.users TO app_auth;

--> statement-breakpoint
-- 呼べるのはアプリ(app_rw)が、鍵から決めた組織の文脈を付けた後だけ。違う組織を渡したら何も足さない(NULL)。
-- 確かめたドメインでなければ check_violation(23514)。同じメールの人がいれば users_tenant_email_key で失敗する
CREATE FUNCTION public.scim_create_user(p_tenant_id uuid, p_user_id uuid, p_email text, p_name text, p_external_id text)
  RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = organizations, pg_temp
  AS $$
  BEGIN
    IF p_tenant_id IS DISTINCT FROM public.app_current_tenant() THEN
      RETURN NULL;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM domains d
       WHERE d.tenant_id = p_tenant_id AND d.verified_at IS NOT NULL
         AND d.domain = split_part(lower(p_email), '@', 2)
    ) THEN
      RAISE EXCEPTION 'scim_create_user: not a verified domain of the tenant' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO users (id, tenant_id, email, name, role, scim_external_id)
      VALUES (p_user_id, p_tenant_id, lower(p_email), p_name, 'member', p_external_id);
    RETURN p_user_id;
  END
  $$;
--> statement-breakpoint
-- ── 止めた人はログインの所属に出さない(0018・0021 と同じ形に1行足す) ──
CREATE OR REPLACE FUNCTION public.auth_find_memberships(p_external_id text, p_email text)
  RETURNS TABLE (user_id uuid, tenant_id uuid, tenant_name text, role organizations.role, last_used_at timestamptz, created_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = organizations, pg_temp
  AS $$
    SELECT u.id, u.tenant_id, t.name, u.role, u.last_used_at, u.created_at
      FROM users u JOIN tenants t ON t.tenant_id = u.tenant_id
     WHERE ((p_external_id IS NOT NULL AND u.external_id = p_external_id)
        OR (p_external_id IS NULL AND u.email = lower(p_email)))
       AND u.disabled_at IS NULL
     ORDER BY u.last_used_at DESC NULLS LAST, u.created_at, u.id
     LIMIT 50
  $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.auth_find_sso_member(p_provider_name text, p_email text)
  RETURNS TABLE (user_id uuid, tenant_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = organizations, pg_temp
  AS $$
    SELECT u.id, u.tenant_id
      FROM sso_connections s
      JOIN domains d ON d.tenant_id = s.tenant_id AND d.verified_at IS NOT NULL
                    AND d.domain = split_part(lower(p_email), '@', 2)
      JOIN users u ON u.tenant_id = s.tenant_id AND u.email = lower(p_email) AND u.disabled_at IS NULL
     WHERE s.provider_name = p_provider_name AND position('@' in p_email) > 1
  $$;
--> statement-breakpoint
-- 持ち主を移すには移り先に CREATE が要るので、その間だけ渡してすぐ取り上げる(0001 と同じ)
GRANT CREATE ON SCHEMA public TO app_auth;
--> statement-breakpoint
ALTER FUNCTION public.auth_find_scim_token(text) OWNER TO app_auth;
--> statement-breakpoint
ALTER FUNCTION public.scim_create_user(uuid, uuid, text, text, text) OWNER TO app_auth;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM app_auth;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.auth_find_scim_token(text), public.scim_create_user(uuid, uuid, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.auth_find_scim_token(text), public.scim_create_user(uuid, uuid, text, text, text) TO app_rw;
--> statement-breakpoint
-- ── 監査ログの行為者の種類に scim ──
-- 同じ名前で、許す値を1つ増やした制約をすぐ足し直す(保証は弱くならない。古い版のアプリは scim を書かない)
-- squawk-ignore ban-drop-constraint
ALTER TABLE platform.audit_events DROP CONSTRAINT audit_events_actor_kind_check;
--> statement-breakpoint
ALTER TABLE platform.audit_events ADD CONSTRAINT audit_events_actor_kind_check
  CHECK (actor_kind IN ('user', 'support', 'system', 'scim')) NOT VALID;

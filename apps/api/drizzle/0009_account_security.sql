-- 長いロック待ちで本番を止めない(squawk: require-lock-timeout / require-statement-timeout)
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- アカウントの安全(docs/specs/0006-account-security.md・docs/designs/0006-account-security.md の 2)。危険度「高」(RLS と権限)。
-- 段: ① 拡張(足すだけ。前の版のアプリもそのまま動く)。縮小は無い。
--
-- 1. 列と表は drizzle-kit が作った形(src/domains/organizations/schema.ts)。定数の既定つきの ADD COLUMN は表を書き直さない。
-- 2. アプリ(app_rw)は自社の行だけ直せる(RLS)。直せる列を決める: 組織の必須・利用者のメール・二段階認証の写し・
--    セッションの有効な始まり。メールの変更の申し込みは読む・足す・確認の時刻だけ直す(消せない)。
-- 3. 「そのメールアドレスは誰かが使っているか」は組織をまたぐので、真偽だけを返す関数 auth_email_in_use に閉じ込める
--    (0001 の auth_find_user_by_email と同じ app_auth の権限。行そのものは返さない)。
-- 戻し方: DROP FUNCTION public.auth_email_in_use(text, uuid); DROP TABLE organizations.email_changes;
--         ALTER TABLE organizations.users DROP COLUMN mfa_enabled, DROP COLUMN sessions_valid_after;
--         ALTER TABLE organizations.tenants DROP COLUMN mfa_required;(前の版のアプリはこれらを読まないので、戻さなくても動く)
CREATE TABLE "organizations"."email_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"previous_email" text NOT NULL,
	"new_email" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "organizations"."tenants" ADD COLUMN "mfa_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations"."users" ADD COLUMN "mfa_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations"."users" ADD COLUMN "sessions_valid_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations"."email_changes" ADD CONSTRAINT "email_changes_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "organizations"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations"."email_changes" ADD CONSTRAINT "email_changes_user_fkey" FOREIGN KEY ("tenant_id","user_id") REFERENCES "organizations"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_changes_user_idx" ON "organizations"."email_changes" USING btree ("tenant_id","user_id","requested_at" DESC NULLS LAST);
--> statement-breakpoint
GRANT UPDATE (mfa_required) ON organizations.tenants TO app_rw;
--> statement-breakpoint
GRANT UPDATE (email, mfa_enabled, sessions_valid_after) ON organizations.users TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT ON organizations.email_changes TO app_rw;
--> statement-breakpoint
GRANT UPDATE (confirmed_at) ON organizations.email_changes TO app_rw;
--> statement-breakpoint
ALTER TABLE organizations.email_changes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organizations.email_changes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON organizations.email_changes
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE FUNCTION public.auth_email_in_use(p_email text, p_user_id uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = organizations, pg_temp
  AS $$ SELECT EXISTS (SELECT 1 FROM users u WHERE u.email = lower(p_email) AND u.id <> p_user_id) $$;
--> statement-breakpoint
-- 持ち主を移すには移り先に CREATE が要るので、その間だけ渡してすぐ取り上げる(0001 と同じ)
GRANT CREATE ON SCHEMA public TO app_auth;
--> statement-breakpoint
ALTER FUNCTION public.auth_email_in_use(text, uuid) OWNER TO app_auth;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM app_auth;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.auth_email_in_use(text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.auth_email_in_use(text, uuid) TO app_rw;

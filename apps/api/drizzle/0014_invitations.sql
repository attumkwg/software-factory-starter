-- 長いロック待ちで本番を止めない(squawk: require-lock-timeout / require-statement-timeout)
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- 招待(docs/specs/0027-invitations.md・docs/designs/0027-invitations.md の 2・ADR 0040)。この移行は危険度「高」(RLS と権限)。
-- 段: ① 拡張(新しい表と関数を足すだけ。前の版のアプリは読まないので、そのまま動く)。縮小は無い。
--
-- 1. 表は drizzle-kit が作った形(src/domains/organizations/schema.ts)。リンクの札は持たない(署名はアプリが作る)。
-- 2. アプリ(app_rw)は自社の招待を読む・作る・取り消す(revoked_at・revoked_by だけ直せる。消せない)。
-- 3. 招待を受ける(users に行が増える)のは auth_accept_invitation の関数だけ。app_rw は users に行を足せないまま。
--    関数は app_auth の権限で動き(0001・0005 と同じ形)、app_auth に許すのは:
--      - 招待: 全社分を読む・生きている招待の accepted_at と accepted_user_id を1回だけ埋める
--      - users: 「受けた招待とメール・ロール・組織がそろう行」だけを足す(ポリシーで確かめる)
-- 戻し方: DROP FUNCTION auth_accept_invitation(uuid, uuid, text); DROP POLICY invitation_accept ON organizations.users;
--         REVOKE INSERT ON organizations.users FROM app_auth; DROP TABLE organizations.invitations;
--         (前の版のアプリは表も関数も使わないので、戻さなくても動く)
CREATE TABLE "organizations"."invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "organizations"."role" NOT NULL,
	"invited_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "invitations_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "organizations"."invitations" ADD CONSTRAINT "invitations_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "organizations"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations"."invitations" ADD CONSTRAINT "invitations_invited_by_fkey" FOREIGN KEY ("tenant_id","invited_by") REFERENCES "organizations"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitations_list_idx" ON "organizations"."invitations" USING btree ("tenant_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "organizations"."invitations" USING btree ("tenant_id","email");--> statement-breakpoint
GRANT SELECT, INSERT ON organizations.invitations TO app_rw;
--> statement-breakpoint
GRANT UPDATE (revoked_at, revoked_by) ON organizations.invitations TO app_rw;
--> statement-breakpoint
ALTER TABLE organizations.invitations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organizations.invitations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON organizations.invitations
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- ── 招待を受ける(app_auth) ──
GRANT SELECT (id, tenant_id, email, role, expires_at, accepted_at, accepted_user_id, revoked_at)
  ON organizations.invitations TO app_auth;
--> statement-breakpoint
GRANT UPDATE (accepted_at, accepted_user_id) ON organizations.invitations TO app_auth;
--> statement-breakpoint
CREATE POLICY invitation_lookup ON organizations.invitations FOR SELECT TO app_auth USING (true);
--> statement-breakpoint
-- 生きている招待だけを、受けた印つきにできる(受けた・取り消した・期限切れには触れない)
CREATE POLICY invitation_accept ON organizations.invitations FOR UPDATE TO app_auth
  USING (accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now())
  WITH CHECK (accepted_at IS NOT NULL AND accepted_user_id IS NOT NULL);
--> statement-breakpoint
GRANT INSERT (id, tenant_id, email, name, role) ON organizations.users TO app_auth;
--> statement-breakpoint
-- 足せるのは「その人の ID で受けた招待」と、組織・メール・ロールがそろう行だけ
CREATE POLICY invitation_accept ON organizations.users FOR INSERT TO app_auth
  WITH CHECK (EXISTS (
    SELECT 1 FROM organizations.invitations i
     WHERE i.accepted_user_id = users.id AND i.tenant_id = users.tenant_id
       AND i.email = users.email AND i.role = users.role
  ));
--> statement-breakpoint
-- 生きている招待を1回だけ受け、その組織に人を足す。生きていなければ何も返さない。
-- メールがもう使われていれば(1人 = 1組織)、users_email_key で失敗し、受けた印も取り消される(呼んだ側のトランザクションごと)
CREATE FUNCTION public.auth_accept_invitation(p_id uuid, p_user_id uuid, p_name text)
  RETURNS TABLE (tenant_id uuid, user_id uuid)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = organizations, pg_temp
  AS $$
  DECLARE
    v_tenant uuid;
    v_email text;
    v_role organizations.role;
  BEGIN
    UPDATE invitations i SET accepted_at = now(), accepted_user_id = p_user_id
     WHERE i.id = p_id AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
     RETURNING i.tenant_id, i.email, i.role INTO v_tenant, v_email, v_role;
    IF v_tenant IS NULL THEN
      RETURN;
    END IF;
    INSERT INTO users (id, tenant_id, email, name, role)
      VALUES (p_user_id, v_tenant, v_email, p_name, v_role);
    tenant_id := v_tenant;
    user_id := p_user_id;
    RETURN NEXT;
  END
  $$;
--> statement-breakpoint
-- 持ち主を移すには移り先に CREATE が要るので、その間だけ渡してすぐ取り上げる(0001 と同じ)
GRANT CREATE ON SCHEMA public TO app_auth;
--> statement-breakpoint
ALTER FUNCTION public.auth_accept_invitation(uuid, uuid, text) OWNER TO app_auth;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM app_auth;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.auth_accept_invitation(uuid, uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.auth_accept_invitation(uuid, uuid, text) TO app_rw;

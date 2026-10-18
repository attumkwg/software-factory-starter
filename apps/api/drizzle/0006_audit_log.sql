-- 長いロック待ちで本番を止めない(squawk: require-lock-timeout / require-statement-timeout)
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- 監査ログ(docs/specs/0003-audit-log.md・ADR 0013)。この移行は危険度「高」(RLS と権限)。
--
-- 1. 表は drizzle-kit が作った形(src/audit/schema.ts)。
-- 2. アプリ(app_rw)は「自社の行を足す・読む」だけ。直す・消す権限は渡さない。
-- 3. 表の持ち主でも、UPDATE は常に・DELETE と TRUNCATE は決まった手順(app.audit_purge = 'on')の外では、トリガーが止める。
CREATE TABLE "platform"."audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"outcome" text NOT NULL,
	"request_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "audit_events_actor_kind_check" CHECK ("actor_kind" IN ('user', 'support', 'system')),
	CONSTRAINT "audit_events_outcome_check" CHECK ("outcome" IN ('allowed', 'denied'))
);
--> statement-breakpoint
ALTER TABLE "platform"."audit_events" ADD CONSTRAINT "audit_events_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "organizations"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_tenant_id_idx" ON "platform"."audit_events" USING btree ("tenant_id","id" DESC NULLS LAST);

--> statement-breakpoint
GRANT SELECT, INSERT ON platform.audit_events TO app_rw;
--> statement-breakpoint
ALTER TABLE platform.audit_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform.audit_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON platform.audit_events
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- 足すだけにする。消してよいのは解約・保存期間の削除の手順だけ(その中で SET LOCAL app.audit_purge = 'on')
CREATE FUNCTION platform.audit_events_append_only()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = platform, pg_temp
  AS $$
  BEGIN
    IF current_setting('app.audit_purge', true) = 'on' THEN
      -- 行ごとの DELETE は OLD を返さないと消えない。TRUNCATE(文ごと)は戻り値を見ない
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      IF TG_OP = 'TRUNCATE' THEN RETURN NULL; END IF;
    END IF;
    RAISE EXCEPTION 'audit_events is append-only (%)', TG_OP USING ERRCODE = 'insufficient_privilege';
  END
  $$;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE ON platform.audit_events
  FOR EACH ROW EXECUTE FUNCTION platform.audit_events_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_delete
  BEFORE DELETE ON platform.audit_events
  FOR EACH ROW EXECUTE FUNCTION platform.audit_events_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON platform.audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION platform.audit_events_append_only();

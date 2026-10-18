-- 長いロック待ちで本番を止めない(squawk: require-lock-timeout / require-statement-timeout)
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- アウトボックス(送信待ちの表。docs/adr/0006-outbox.md)。この移行は危険度「高」(RLS と権限)。
--
-- 1. 表は drizzle-kit が作った形(src/outbox/schema.ts)。
-- 2. アプリ(app_rw)は「自社の行を書く」だけ。読めない(他社の出来事を読めないように)。
-- 3. 送り出し(src/outbox/relay.ts)は、決まった3つの関数だけを通して全社分を扱う。
--    関数は app_outbox の権限で動き、app_outbox にだけ全社分を扱うポリシーを付ける(0001 の app_auth と同じ形)。
CREATE SCHEMA "platform";
--> statement-breakpoint
CREATE TABLE "platform"."outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	-- squawk-ignore prefer-bigint-over-int
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"dead_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "platform"."outbox" ADD CONSTRAINT "outbox_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "organizations"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "platform"."outbox" USING btree ("available_at") WHERE "platform"."outbox"."sent_at" is null and "platform"."outbox"."dead_at" is null;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_outbox') THEN
    CREATE ROLE app_outbox NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA platform TO app_rw;
--> statement-breakpoint
GRANT INSERT ON platform.outbox TO app_rw;
--> statement-breakpoint
ALTER TABLE platform.outbox ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform.outbox FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON platform.outbox
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
GRANT app_outbox TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA platform TO app_outbox;
--> statement-breakpoint
GRANT SELECT, UPDATE ON platform.outbox TO app_outbox;
--> statement-breakpoint
CREATE POLICY relay ON platform.outbox FOR ALL TO app_outbox USING (true) WITH CHECK (true);
--> statement-breakpoint
-- 送るべき物を取り、「借りている期限」を付けて返す。ほかの台が同時に呼んでも、同じ行は返らない(SKIP LOCKED)
CREATE FUNCTION outbox_claim(p_limit integer, p_lease_seconds integer)
  RETURNS SETOF platform.outbox
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = platform, pg_temp
  AS $$
    UPDATE outbox o
       SET locked_until = now() + make_interval(secs => p_lease_seconds),
           attempts = o.attempts + 1
     WHERE o.id IN (
       SELECT id FROM outbox
        WHERE sent_at IS NULL AND dead_at IS NULL AND available_at <= now()
          AND (locked_until IS NULL OR locked_until < now())
        ORDER BY id
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED)
    RETURNING o.*
  $$;
--> statement-breakpoint
CREATE FUNCTION outbox_mark_sent(p_id uuid)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = platform, pg_temp
  AS $$ UPDATE outbox SET sent_at = now(), locked_until = NULL WHERE id = p_id $$;
--> statement-breakpoint
CREATE FUNCTION outbox_mark_failed(p_id uuid, p_error text, p_retry_seconds integer, p_dead boolean)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = platform, pg_temp
  AS $$
    UPDATE outbox
       SET last_error = left(p_error, 500),
           locked_until = NULL,
           available_at = now() + make_interval(secs => p_retry_seconds),
           dead_at = CASE WHEN p_dead THEN now() END
     WHERE id = p_id
  $$;
--> statement-breakpoint
-- 持ち主を移すには移り先に CREATE が要るので、その間だけ渡してすぐ取り上げる(0001 と同じ)
GRANT CREATE ON SCHEMA public TO app_outbox;
--> statement-breakpoint
ALTER FUNCTION outbox_claim(integer, integer) OWNER TO app_outbox;
--> statement-breakpoint
ALTER FUNCTION outbox_mark_sent(uuid) OWNER TO app_outbox;
--> statement-breakpoint
ALTER FUNCTION outbox_mark_failed(uuid, text, integer, boolean) OWNER TO app_outbox;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM app_outbox;
--> statement-breakpoint
REVOKE ALL ON FUNCTION outbox_claim(integer, integer), outbox_mark_sent(uuid), outbox_mark_failed(uuid, text, integer, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION outbox_claim(integer, integer), outbox_mark_sent(uuid), outbox_mark_failed(uuid, text, integer, boolean) TO app_rw;

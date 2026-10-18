-- 長いロック待ちで本番を止めない(squawk: require-lock-timeout / require-statement-timeout)
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- 組織の時間帯(ADR 0005)。既定のある列を足すだけなので、表を書き直さない(Postgres 11 以降)
ALTER TABLE "organizations"."tenants" ADD COLUMN "time_zone" text DEFAULT 'Asia/Tokyo' NOT NULL;
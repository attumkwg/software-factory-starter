-- 1人が複数の組織に所属する形の段 ①: 組織ごとの一意の索引(docs/designs/0055-multi-org-membership.md の 2)。
-- すでにある表なので、トランザクションの外で CONCURRENTLY に作る(書き込みを止めない。ADR 0016)。
-- 全体の一意(users_email_key・users_external_id_key)は段 ③ の移行で消す。それまでは両方ある。
SET lock_timeout = '1min';--> statement-breakpoint
SET statement_timeout = '1h';--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS users_tenant_email_key ON organizations.users USING btree (tenant_id, email);--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS users_tenant_external_id_key ON organizations.users USING btree (tenant_id, external_id);

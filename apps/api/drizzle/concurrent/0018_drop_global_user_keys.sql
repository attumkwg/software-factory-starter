-- 1人が複数の組織に所属する形の段 ③: 全体で一意の索引を消す(docs/designs/0055-multi-org-membership.md の 2)。**戻せない**
-- (同じ人の行が2つの組織にできると、張り直せない)。トランザクションの外で CONCURRENTLY に(書き込みを止めない。ADR 0016)。
SET lock_timeout = '1min';--> statement-breakpoint
SET statement_timeout = '1h';--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS organizations.users_email_key;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS organizations.users_external_id_key;

-- トランザクションの外で流す移行(src/db/migrate.ts)。CREATE INDEX CONCURRENTLY は書き込みを止めずに索引を作る。
-- 途中で失敗すると「使えない索引」(indisvalid = false)が残るので、次に流すときに migrate.ts が消してから作り直す。
-- 何度流しても同じになるように IF NOT EXISTS を付ける。
--
-- lock_timeout: 作り始めに、表を直す操作(VACUUM・ALTER)とだけぶつかるロックを取る。読み書きは止めないので長めに待つ。
-- statement_timeout: 大きい表は数分かかる。1時間で打ち切る(超えるほど大きい表は、手で流す。.claude/skills/db-migration の 5)。
SET lock_timeout = '1min';--> statement-breakpoint
SET statement_timeout = '1h';--> statement-breakpoint
-- プロジェクトの一覧(新しい順)。後ろから読めば created_at・id の大きい順
CREATE INDEX CONCURRENTLY IF NOT EXISTS "projects_tenant_id_created_at_id_idx" ON "projects"."projects" USING btree ("tenant_id","created_at","id");--> statement-breakpoint
-- タスクの一覧(プロジェクトごと・古い順)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "tasks_tenant_id_project_id_created_at_id_idx" ON "tasks"."tasks" USING btree ("tenant_id","project_id","created_at","id");

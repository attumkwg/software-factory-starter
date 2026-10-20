-- 一覧のページングに合う索引(プロジェクト・タスク)。
--
-- drizzle の移行はトランザクションの中で流れるので、ここで CREATE INDEX を書くと、作り終わるまで
-- その表への書き込みが止まる(大きい表なら数分)。だから索引は drizzle/concurrent/0008_list_indexes.sql で、
-- トランザクションの外から CONCURRENTLY で作る(src/db/migrate.ts が、この移行のすぐ後に流す)。
-- このファイルは、drizzle の記録(meta/0008_snapshot.json)を表の定義(schema.ts)とそろえるためだけにある。
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';

-- 長いロック待ちで本番を止めない(squawk: require-lock-timeout / require-statement-timeout)
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- 組織の「タスクが完了したメール」を止める・戻す(docs/specs/0093-task-mail-switch.md・docs/designs/0089-task-mail-switch.md の 2)。
-- 危険度「高」(DB の移行)。段: ① 拡張(足すだけ)。既定値は定数なので、表を書き直さない(Postgres 11 から)。
-- 列は tenants の行に乗るので、RLS・解約の削除は今のまま。app_rw は tenants を列ごとにしか更新できないので、
-- この列だけ渡す(二段階認証の必須 0009 と同じ)。読むのは 0001 の SELECT のまま。
-- 戻し方: 前の版のアプリはこの列を読まないので、そのまま動く。消すなら別の PR で DROP COLUMN(縮小の段)。
ALTER TABLE "organizations"."tenants" ADD COLUMN "task_completed_mail" boolean DEFAULT true NOT NULL;--> statement-breakpoint
GRANT UPDATE (task_completed_mail) ON organizations.tenants TO app_rw;

-- 長いロック待ちで本番を止めない(squawk: require-lock-timeout / require-statement-timeout)
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- 組織の管理者が、人のロールを変える(docs/specs/0079-member-admin.md・docs/designs/0079-member-admin.md の 2)。
-- 危険度「高」(権限)。段: ① 拡張(足すだけ)。
--
-- users.role をアプリ(app_rw)が書けるようにする。止める・戻す(disabled_at)は 0022 で書ける。
-- 誰のロールを変えてよいか(管理者だけ・自分は変えない・有効な管理者を0人にしない)はアプリの認可の関所と
-- 領域の関数が決める。行が組織の中だけなのは、users の RLS(0001)のまま。
-- 戻し方: REVOKE UPDATE (role) ON organizations.users FROM app_rw;(前の版のアプリはロールを書かないので、そのまま動く)
GRANT UPDATE (role) ON organizations.users TO app_rw;

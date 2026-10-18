-- 長いロック待ちで本番を止めない(squawk: require-lock-timeout / require-statement-timeout)
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- 領域ごとに Postgres のスキーマを分ける(docs/adr/0004-domain-boundaries.md)。この移行は危険度「高」。
--
-- 表は「移す」だけ(作り直さない)。行・索引・制約・RLS のポリシー・権限は表と一緒に移る。
-- drizzle-kit は表の移動を対話でしか作れないので、この SQL は手で書いた(meta/0002_snapshot.json は新しい形)。
--
-- ⚠️ squawk の ban-set-schema を、この移行だけ外している。表を移すと、古い版のアプリ(移る前の名前で探す)が止まる。
--    まだ本番が無い今だから一度に移せる。本番ができてから同じことをするなら、段階を踏む
--    (新しいスキーマにビューを置く → アプリを新しい名前に → 表を移す → ビューを消す)。.claude/skills/db-migration
CREATE SCHEMA organizations;
--> statement-breakpoint
CREATE SCHEMA projects;
--> statement-breakpoint
CREATE SCHEMA tasks;
--> statement-breakpoint
-- squawk-ignore ban-set-schema
ALTER TYPE public.role SET SCHEMA organizations;
--> statement-breakpoint
-- squawk-ignore ban-set-schema
ALTER TABLE public.tenants SET SCHEMA organizations;
--> statement-breakpoint
-- squawk-ignore ban-set-schema
ALTER TABLE public.users SET SCHEMA organizations;
--> statement-breakpoint
-- squawk-ignore ban-set-schema
ALTER TABLE public.projects SET SCHEMA projects;
--> statement-breakpoint
-- squawk-ignore ban-set-schema
ALTER TABLE public.tasks SET SCHEMA tasks;
--> statement-breakpoint
-- アプリの接続ユーザーが新しいスキーマの中に入れるように(表の権限は表と一緒に移っている)
GRANT USAGE ON SCHEMA organizations, projects, tasks TO app_rw;
--> statement-breakpoint
GRANT USAGE ON SCHEMA organizations TO app_auth;
--> statement-breakpoint
-- ログインのときの引き当て(0001_rls.sql)は users を名前で探すので、探す場所を移った先に向け直す
ALTER FUNCTION auth_find_user_by_email(text) SET search_path = organizations, pg_temp;
--> statement-breakpoint
ALTER FUNCTION auth_find_user_by_external_id(text) SET search_path = organizations, pg_temp;

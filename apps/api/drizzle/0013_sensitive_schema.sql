-- 長いロック待ちで本番を止めない(squawk: require-lock-timeout / require-statement-timeout)
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- 要配慮個人情報の置き場所(ADR 0018 の段1・ADR 0029・docs/designs/0016-sensitive-data-tier1.md の 2)。
-- 危険度「高」(スキーマ・ロール・RLS)。段: ① 拡張(新しいスキーマと表を足すだけ。前の版のアプリは読まないので、そのまま動く)。縮小は無い。
--
-- 1. スキーマ sensitive と、組織ごとのデータ鍵の表 tenant_keys(src/sensitive/schema.ts。drizzle-kit が作った形)。
--    ほかのスキーマの表へ外部キーを張らない(段2で別のクラスターへ持ち出せるように)。
-- 2. 読み書きできるのは専用のロール app_sensitive だけ。**アプリの接続(app_rw)には何も渡さない**(スキーマにも入れない)。
--    app_sensitive にも、ほかのスキーマの表は何も渡さない(ふつうのデータと要配慮のデータを、同じ接続で読めない)。
-- 3. RLS は全部の表と同じ形(テナントの文脈が無ければ1行も見えない)。データ鍵は「読む・足す」だけ。
--    消すのは解約のコマンド(表の持ち主。delete-tenant の TENANT_TABLES)だけ = 暗号による消去。
-- 戻し方: DROP TABLE sensitive.tenant_keys; DROP SCHEMA sensitive;(前の版のアプリは読まないので、戻さなくても動く。
--         DROP TABLE はデータ鍵を消す = その組織の要配慮の暗号文が全部読めなくなる。要配慮の表があるなら戻さない)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_sensitive') THEN
    CREATE ROLE app_sensitive NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
CREATE SCHEMA "sensitive";
--> statement-breakpoint
CREATE TABLE "sensitive"."tenant_keys" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"kms_key_id" text NOT NULL,
	"wrapped_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- スキーマに入れるのは app_sensitive だけ(既定でも PUBLIC は入れないが、念のため明示する)
REVOKE ALL ON SCHEMA sensitive FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA sensitive TO app_sensitive;
--> statement-breakpoint
-- RLS のポリシーが呼ぶ app_current_tenant() は public にある(0001)
GRANT USAGE ON SCHEMA public TO app_sensitive;
--> statement-breakpoint
GRANT SELECT, INSERT ON sensitive.tenant_keys TO app_sensitive;
--> statement-breakpoint
ALTER TABLE sensitive.tenant_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sensitive.tenant_keys FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON sensitive.tenant_keys
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

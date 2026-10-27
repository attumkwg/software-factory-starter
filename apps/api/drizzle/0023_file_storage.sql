-- 長いロック待ちで本番を止めない(squawk: require-lock-timeout / require-statement-timeout)
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- 写真・ファイルの保存(docs/specs/0072-file-storage.md・docs/designs/0072-file-storage.md の 2)。
-- 危険度「高」(新しいスキーマ・RLS・引き金)。段: ① 拡張(足すだけ)。
--
-- 1. スキーマ files と表 files.files(目録だけ。中身は置き場の S3)。
-- 2. タスクへの外部キーは id だけ(tasks に (tenant_id, id) の一意が無い。組織が同じことは作るときに確かめ、
--    RLS の WITH CHECK で tenant_id はいまの組織だけ)。タスクを消すと行も消える(cascade)。
--    新しい表への外部キーなので、tasks の行を読み直さない(空の表から張る)。
-- 3. 行が消えたら、同じトランザクションで送信待ち(platform.outbox)に files.file_deleted を積む引き金。
--    本人が消す・タスクやプロジェクトの cascade・解約の削除のどれでも、置き場の中身が残らない(送り出しが消す)。
--    引き金は呼んだ人の権限で動く(security invoker)。RLS の下で、その組織の行として積む。中身は ID だけ(ADR 0006)。
--    出来事の ID はアプリが UUIDv7 で作るが、ここでは gen_random_uuid()(送り出しは available_at の順に取る)。
-- 戻し方: DROP SCHEMA files CASCADE;(引き金と関数も消える。行があれば、置き場の中身は運営が手順書で消す)
--         前の版のアプリはこのスキーマを使わないので、そのまま動く。
CREATE SCHEMA "files";
--> statement-breakpoint
CREATE TABLE "files"."files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"stored_byte_size" bigint,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	CONSTRAINT "files_content_type_check" CHECK ("files"."files"."content_type" in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
	CONSTRAINT "files_byte_size_check" CHECK ("files"."files"."byte_size" between 1 and 20971520),
	CONSTRAINT "files_status_check" CHECK ("files"."files"."status" in ('pending', 'ready', 'rejected')),
	CONSTRAINT "files_name_check" CHECK (char_length("files"."files"."name") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "files"."files" ADD CONSTRAINT "files_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "organizations"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files"."files" ADD CONSTRAINT "files_task_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_tenant_id_task_id_created_at_id_idx" ON "files"."files" USING btree ("tenant_id","task_id","created_at","id");
--> statement-breakpoint
GRANT USAGE ON SCHEMA files TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON files.files TO app_rw;
--> statement-breakpoint
GRANT UPDATE (status, stored_byte_size, ready_at) ON files.files TO app_rw;
--> statement-breakpoint
ALTER TABLE files.files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE files.files FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON files.files
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE FUNCTION files.enqueue_object_deletion() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    INSERT INTO platform.outbox (id, tenant_id, topic, payload)
      VALUES (gen_random_uuid(), OLD.tenant_id, 'files.file_deleted', jsonb_build_object('fileId', OLD.id));
    RETURN OLD;
  END
  $$;
--> statement-breakpoint
CREATE TRIGGER files_enqueue_object_deletion
  AFTER DELETE ON files.files
  FOR EACH ROW EXECUTE FUNCTION files.enqueue_object_deletion();

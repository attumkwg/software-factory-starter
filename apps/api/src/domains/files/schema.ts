import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  pgSchema,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id } from "../../db/columns.ts";
import { tenants } from "../organizations/schema.ts";
import { tasks } from "../tasks/schema.ts";

// 領域「ファイル」(docs/domain/files)。Postgres のスキーマ files に置く。
// 中身は置き場(S3。src/storage)にあり、ここは目録だけ(docs/designs/0072-file-storage.md の 2)。
// 行が消えたら、引き金(移行 0023)が同じトランザクションで files.file_deleted を積み、送り出しが中身を消す。

export const filesSchema = pgSchema("files");

export const files = filesSchema.table(
  "files",
  {
    id: id("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    taskId: uuid("task_id").notNull(),
    /** 上げた人(人が抜けても消さない。タスクの作り手と同じ扱い) */
    uploadedBy: uuid("uploaded_by").notNull(),
    /** 元の名前(表示と保存の名前)。キー・URL・ログには入れない */
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    /** 上げると言った大きさ(署名に入れる) */
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    /** 書き直した後の大きさ */
    storedByteSize: bigint("stored_byte_size", { mode: "number" }),
    status: text("status").notNull().default("pending"),
    createdAt: createdAt(),
    readyAt: timestamp("ready_at", { withTimezone: true }),
  },
  (t) => [
    // 一覧(古い順・ページング)の並び
    index("files_tenant_id_task_id_created_at_id_idx").on(t.tenantId, t.taskId, t.createdAt, t.id),
    // 領域をまたぐ外部キー(→ tasks)。タスクを消すとファイルの行も消える(中身は引き金と送り出し)。
    // tasks には (tenant_id, id) の一意が無いので id だけで張る。組織が同じことは、作るときに taskExists で
    // 確かめる(RLS の WITH CHECK で tenant_id はいまの組織だけ)。DB を分けるときに切る一覧は ADR 0004
    foreignKey({
      name: "files_task_fkey",
      columns: [t.taskId],
      foreignColumns: [tasks.id],
    }).onDelete("cascade"),
    check(
      "files_content_type_check",
      sql`${t.contentType} in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')`,
    ),
    check("files_byte_size_check", sql`${t.byteSize} between 1 and 20971520`),
    check("files_status_check", sql`${t.status} in ('pending', 'ready', 'rejected')`),
    check("files_name_check", sql`char_length(${t.name}) between 1 and 200`),
  ],
);

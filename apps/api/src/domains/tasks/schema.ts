import { boolean, foreignKey, index, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, id } from "../../db/columns.ts";
import { tenants } from "../organizations/schema.ts";
import { projects } from "../projects/schema.ts";

// 領域「タスク」(docs/domain/tasks)。Postgres のスキーマ tasks に置く。

export const tasksSchema = pgSchema("tasks");

export const tasks = tasksSchema.table(
  "tasks",
  {
    id: id("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    projectId: uuid("project_id").notNull(),
    title: text("title").notNull(),
    done: boolean("done").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tasks_tenant_id_project_id_idx").on(t.tenantId, t.projectId),
    // 一覧(古い順・ページング)の並び順と同じ。上の索引はこれで要らなくなる(消すのは別の PR。縮小の段)。
    // 作るのはトランザクションの外(drizzle/concurrent/0008_list_indexes.sql)。書き込みを止めないため
    index("tasks_tenant_id_project_id_created_at_id_idx").on(
      t.tenantId,
      t.projectId,
      t.createdAt,
      t.id,
    ),
    // 領域をまたぐ外部キー(→ projects)。プロジェクトを消すとタスクも消える。DB を分けるときに切る一覧は ADR 0004
    foreignKey({
      name: "tasks_project_fkey",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [projects.tenantId, projects.id],
    }).onDelete("cascade"),
  ],
);

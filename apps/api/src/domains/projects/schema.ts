import { foreignKey, pgSchema, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, id } from "../../db/columns.ts";
import { tenants, users } from "../organizations/schema.ts";

// 領域「プロジェクト」(docs/domain/projects)。Postgres のスキーマ projects に置く。

export const projectsSchema = pgSchema("projects");

export const projects = projectsSchema.table(
  "projects",
  {
    id: id("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    name: text("name").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("projects_tenant_id_id_key").on(t.tenantId, t.id),
    // 領域をまたぐ外部キー(→ organizations)。DB を分けるときに切る一覧は ADR 0004
    foreignKey({
      name: "projects_created_by_fkey",
      columns: [t.tenantId, t.createdBy],
      foreignColumns: [users.tenantId, users.id],
    }),
  ],
);

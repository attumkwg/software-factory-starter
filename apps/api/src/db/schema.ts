import { ROLES } from "@app/shared";
import {
  boolean,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";

// ルール(docs/adr/0001):
// - 全テーブルに tenant_id(UUIDv7)。RLS は drizzle/0001_rls.sql で有効化している。
// - 新しい表を足したら、同じ PR で RLS の移行も足す(結合テスト「全テーブルに RLS」が落ちる)。
// - 表どうしの参照は (tenant_id, id) の組で張り、別テナントの行を指せないようにする。

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const roleEnum = pgEnum("role", ROLES);

export const tenants = pgTable("tenants", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    // いまは「1人 = 1組織」。複数の組織に入る人は、組織ごとに行を持つ(ADR 0001 の今後)
    email: text("email").notNull(),
    // 認証の製品(Cognito)側の ID(sub)
    externalId: text("external_id"),
    name: text("name").notNull(),
    role: roleEnum("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("users_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("users_email_key").on(t.email),
    uniqueIndex("users_external_id_key").on(t.externalId),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    name: text("name").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("projects_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "projects_created_by_fkey",
      columns: [t.tenantId, t.createdBy],
      foreignColumns: [users.tenantId, users.id],
    }),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
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
    foreignKey({
      name: "tasks_project_fkey",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [projects.tenantId, projects.id],
    }).onDelete("cascade"),
  ],
);

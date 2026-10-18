import { ROLES } from "@app/shared";
import { pgSchema, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id } from "../../db/columns.ts";

// 領域「組織」(docs/domain/organizations)。Postgres のスキーマ organizations に置く。
// ほかの領域は、この表を外部キーで指してよい(組織と人は全領域の土台)。読むときは index.ts の関数を通す。

export const organizations = pgSchema("organizations");

export const roleEnum = organizations.enum("role", ROLES);

export const tenants = organizations.table("tenants", {
  tenantId: id("tenant_id"),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const users = organizations.table(
  "users",
  {
    id: id("id"),
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

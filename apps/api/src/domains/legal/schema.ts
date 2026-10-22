import { bigint, foreignKey, pgSchema, text, unique, uuid } from "drizzle-orm/pg-core";
import { id, instant } from "../../db/columns.ts";
import { tenants, users } from "../organizations/schema.ts";

// 領域「規約と同意」(docs/specs/0009-legal-consent.md・ADR 0022)。Postgres のスキーマ legal に置く。
// 文書と版の一覧は @app/shared の LEGAL_VERSIONS(本文は画面のリポジトリの Markdown)。ここは記録だけ。
// どちらの表も**足すだけ**(アプリの接続ユーザーは SELECT・INSERT だけ。消すのは解約のコマンドだけ)。

export const legal = pgSchema("legal");

/**
 * 同意の記録。誰が・どの文書の・どの版に・いつ・どの画面から・組織としてか本人としてか。
 * 同じ人の同じ版は1行だけ(2回目は何もしない。最初の時刻を残す)。
 *   document … "terms" / "privacy"(@app/shared の LEGAL_DOCUMENTS。足すときに移行が要らないよう enum にしない)
 *   capacity … "organization"(利用規約を管理者が。契約者として)/ "individual"(本人として)
 *   source   … "sign_up"(登録の画面)/ "acceptance"(同意の画面・帯から前もって)
 */
export const consents = legal.table(
  "consents",
  {
    id: id("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    userId: uuid("user_id").notNull(),
    document: text("document").notNull(),
    version: bigint("version", { mode: "number" }).notNull(),
    capacity: text("capacity").notNull(),
    source: text("source").notNull(),
    acceptedAt: instant("accepted_at").notNull().defaultNow(),
  },
  (t) => [
    // 関所の問い合わせ(本人の、文書ごとの最大の版)にもこの索引を使う
    unique("consents_user_version_key").on(t.tenantId, t.userId, t.document, t.version),
    foreignKey({
      name: "consents_user_fkey",
      columns: [t.tenantId, t.userId],
      foreignColumns: [users.tenantId, users.id],
    }),
  ],
);

/**
 * お知らせのメールを送ると決めた記録(運営のコマンド legal-notify が足す)。周知した証拠と、2回送らない守りを兼ねる。
 * アウトボックスの出来事の中身はこの ID だけ。宛先のアドレスは送る直前に読む。
 */
export const notices = legal.table(
  "notices",
  {
    id: id("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    userId: uuid("user_id").notNull(),
    document: text("document").notNull(),
    version: bigint("version", { mode: "number" }).notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("notices_user_version_key").on(t.tenantId, t.userId, t.document, t.version),
    foreignKey({
      name: "notices_user_fkey",
      columns: [t.tenantId, t.userId],
      foreignColumns: [users.tenantId, users.id],
    }),
  ],
);

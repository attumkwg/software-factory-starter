import { text, unique, uuid } from "drizzle-orm/pg-core";
import { id, instant } from "../db/columns.ts";
import { tenants } from "../domains/organizations/schema.ts";
import { platform } from "../outbox/schema.ts";

// 組織ごとの機能フラグ(docs/specs/0012-feature-flags-and-usage.md・ADR 0025)。共通の仕組みなので platform に置く。
// 定義(名前・賭け・状態)は @app/shared の FEATURE_FLAGS。ここは「この組織にこの機能を入れた」だけ(行がある = 入っている)。
// アプリ(app_rw)は**読むだけ**。入れる・切るのは運営のコマンド(cli.ts の feature-flag。表の持ち主の接続)だけ。

export const featureFlags = platform.table(
  "feature_flags",
  {
    id: id("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    /** FEATURE_FLAGS の name(足すたびに移行が要らないよう enum にしない) */
    flag: text("flag").notNull(),
    enabledAt: instant("enabled_at").notNull().defaultNow(),
  },
  // 組織の行を引くのもこの索引
  (t) => [unique("feature_flags_tenant_flag_key").on(t.tenantId, t.flag)],
);

import { foreignKey, index, text, unique, uuid } from "drizzle-orm/pg-core";
import { dateOnly, id } from "../db/columns.ts";
import { tenants, users } from "../domains/organizations/schema.ts";
import { platform } from "../outbox/schema.ts";

// 利用の記録(docs/specs/0012-feature-flags-and-usage.md・ADR 0025)。賭けの線(使う組織の割合・使い続ける割合)を測るため。
// 共通の仕組みなので platform に置く。**どの組織の・誰が・どの機能を・どの日に** だけを持つ(1日1人1機能1行)。
// 何をしたか・中身・回数・時刻(秒まで)・URL・IP・ブラウザは持たない(設計書 0012 の 2)。
// アプリ(app_rw)は読む・足すだけ。消すのは運営のコマンド(usage-purge・保存期間)と解約のコマンドだけ。

export const featureUsage = platform.table(
  "feature_usage",
  {
    id: id("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    userId: uuid("user_id").notNull(),
    /** FEATURE_FLAGS の name */
    feature: text("feature").notNull(),
    /** 使った日(組織の時間帯での日付) */
    day: dateOnly("day").notNull(),
  },
  (t) => [
    // 同じ人の同じ日の同じ機能は1行だけ(2回目からは何もしない)
    unique("feature_usage_once_a_day_key").on(t.tenantId, t.userId, t.feature, t.day),
    // 集計(機能ごと・日の範囲)と、保存期間の削除(日より前)
    index("feature_usage_feature_day_idx").on(t.tenantId, t.feature, t.day),
    foreignKey({
      name: "feature_usage_user_fkey",
      columns: [t.tenantId, t.userId],
      foreignColumns: [users.tenantId, users.id],
    }),
  ],
);

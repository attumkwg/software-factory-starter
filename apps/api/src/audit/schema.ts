import { sql } from "drizzle-orm";
import { index, jsonb, text, uuid } from "drizzle-orm/pg-core";
import { id, instant } from "../db/columns.ts";
import { tenants } from "../domains/organizations/schema.ts";
import { platform } from "../outbox/schema.ts";

// 監査ログ(誰が・いつ・何をしたか。docs/specs/0003-audit-log.md・ADR 0013)。共通の仕組みなので platform に置く。
//
// **足すだけ**: アプリ(app_rw)は INSERT と SELECT だけ。UPDATE は常に、DELETE は決まった手順
// (解約・保存期間の削除。app.audit_purge = 'on')の外では、移行 0006 のトリガーが止める。
// 値(お客さんが入れた題名・本文)は入れない。ID と項目の名前だけ。

export const auditEvents = platform.table(
  "audit_events",
  {
    id: id("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    occurredAt: instant("occurred_at").notNull().defaultNow(),
    /**
     * user = 自社の人 / support = 代理ログインの社員 / system = 仕組み(送り出し・解約の処理など) /
     * scim = 情シスの道具(SCIM の鍵)
     */
    actorKind: text("actor_kind", { enum: ["user", "support", "system", "scim"] }).notNull(),
    /** user なら users の ID。support なら運営の社員の ID(別の組織の人なので外部キーは張らない)。scim なら鍵の ID */
    actorId: uuid("actor_id"),
    /** 何をしたか(「対象.動作」。src/audit/actions.ts) */
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: uuid("target_id"),
    outcome: text("outcome", { enum: ["allowed", "denied"] }).notNull(),
    /** アプリのログ(Logs Insights)と突き合わせる */
    requestId: text("request_id"),
    /** 直した項目の名前など(値は入れない) */
    details: jsonb("details").notNull().default(sql`'{}'::jsonb`),
  },
  // 新しい順に読む(ID は UUIDv7 なので時刻の順に並ぶ。ページの続きも ID で切る)
  (t) => [index("audit_events_tenant_id_idx").on(t.tenantId, t.id.desc())],
);

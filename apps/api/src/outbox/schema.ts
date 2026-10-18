import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, id } from "../db/columns.ts";
import { tenants } from "../domains/organizations/schema.ts";

// アウトボックス(送信待ちの表。docs/adr/0006-outbox.md)。領域ではなく共通の仕組みなので、スキーマ platform に置く。
//
// 業務の変更と「起きたこと(イベント)」を**同じトランザクションで**書く。どちらか片方だけが残ることが無い。
// 送り出し(relay.ts)は後から別に読んで送る。送れたら sent_at、だめなら時間をおいてやり直す。
// アプリは書くだけ(読めない)。読む・印を付けるのは移行 0004 の関数だけ。

export const platform = pgSchema("platform");

export const outbox = platform.table(
  "outbox",
  {
    id: id("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    /** 何が起きたか(「領域.出来事」。topics.ts) */
    topic: text("topic").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: createdAt(),
    /** この時刻より後に送る(失敗したら先へずらす) */
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    /** 送り出しが取ってから、この時刻までは他が取らない(送り出しが落ちたら、過ぎたあと取り直す) */
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** 何度やってもだめで、あきらめた(人が見て直す) */
    deadAt: timestamp("dead_at", { withTimezone: true }),
    /** 最後の失敗の種類と文(payload は入れない) */
    lastError: text("last_error"),
  },
  (t) => [
    // 送るべき物だけを探す索引(送り終わった行は数えない)
    index("outbox_pending_idx")
      .on(t.availableAt)
      .where(sql`${t.sentAt} is null and ${t.deadAt} is null`),
  ],
);

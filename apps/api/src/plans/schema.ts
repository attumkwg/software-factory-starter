import { index, integer, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, dateOnly, id } from "../db/columns.ts";
import { tenants } from "../domains/organizations/schema.ts";
import { platform } from "../outbox/schema.ts";

// 組織の契約のプラン(docs/specs/0047-plans.md・ADR 0058)。共通の仕組みなので platform に置く。
// 定義(プラン・価格表)は @app/shared の PLANS・PRICE_LISTS。ここは「この組織は、いつから・どのプランを・どの価格表で」。
// **足すだけ**(変えるたびに1行。いまのプランは effective_on が今日までで一番新しい行)。直さない・消さない(解約の削除だけ)。
// アプリ(app_rw)は**読むだけ**。書くのは運営のコマンド(cli.ts の plan・create-tenant。表の持ち主の接続)だけ。

export const tenantPlans = platform.table(
  "tenant_plans",
  {
    id: id("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    /** PLANS の id(足すたびに移行が要らないよう enum にしない) */
    plan: text("plan").notNull(),
    /** PRICE_LISTS の id(どの版の価格表で契約しているか) */
    priceList: text("price_list").notNull(),
    /** 契約の人数。null は上限なし。超えても止めない(運営が plan-report と毎週の点検で知る) */
    seats: integer("seats"),
    /** 据え置き(この価格表のまま)の期限。null は据え置きなし(次の値上げで新しい価格表に移す) */
    priceLockedUntil: dateOnly("price_locked_until"),
    /** この契約がいつからか(組織の時間帯の日付) */
    effectiveOn: dateOnly("effective_on").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("tenant_plans_current_idx").on(t.tenantId, t.effectiveOn.desc(), t.createdAt.desc()),
  ],
);

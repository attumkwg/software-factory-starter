import { bigint, foreignKey, text, unique, uuid } from "drizzle-orm/pg-core";
import { dateOnly, id } from "../db/columns.ts";
import { tenants, users } from "../domains/organizations/schema.ts";
import { platform } from "../outbox/schema.ts";

// 「無くなったら困るか」を聞く(docs/specs/0046-pmf-survey.md・ADR 0057)。共通の仕組みなので platform に置く。
// **だれが何と答えたかを結びつけない**ため、表を2つに分ける:
//   pmf_survey_asked  … この人にこの回は聞き終えた(1人1回の印)。答えは持たない
//   pmf_survey_counts … 組織・回・答えごとの数。人の ID も時刻も持たない
// アプリ(app_rw)は asked を読む・足すだけ、counts を読む・足す・数を増やすだけ。消すのは運営のコマンドと解約のコマンド。

export const pmfSurveyAsked = platform.table(
  "pmf_survey_asked",
  {
    id: id("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    userId: uuid("user_id").notNull(),
    /** 聞いた回(「2026-Q4」。組織の時間帯の四半期) */
    round: text("round").notNull(),
    /** 答えた日(組織の時間帯。時刻は持たない。保存期間の削除に使う) */
    day: dateOnly("day").notNull(),
  },
  (t) => [
    // 1人1回(同じ回の2回目は 409)
    unique("pmf_survey_asked_once_key").on(t.tenantId, t.userId, t.round),
    foreignKey({
      name: "pmf_survey_asked_user_fkey",
      columns: [t.tenantId, t.userId],
      foreignColumns: [users.tenantId, users.id],
    }),
  ],
);

export const pmfSurveyCounts = platform.table(
  "pmf_survey_counts",
  {
    id: id("id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    round: text("round").notNull(),
    /** @app/shared の PMF_SURVEY_ANSWERS */
    answer: text("answer").notNull(),
    count: bigint("count", { mode: "number" }).notNull(),
  },
  (t) => [unique("pmf_survey_counts_answer_key").on(t.tenantId, t.round, t.answer)],
);

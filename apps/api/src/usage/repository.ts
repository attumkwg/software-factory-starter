import { type FeatureFlagName, toLocalDate } from "@app/shared";
import type { Context } from "hono";
import { findTimeZone } from "../domains/organizations/index.ts";
import type { AppEnv } from "../env.ts";
import { featureUsage } from "./schema.ts";

// 利用の記録を足す(docs/specs/0012-feature-flags-and-usage.md)。機能の API のハンドラーの中で呼ぶ。

/**
 * 「この人が今日この機能を使った」を1行足す。同じ日の2回目からは何もしない(1日1人1機能1行)。
 * 操作と**同じトランザクション**(c.var.tx)なので、操作が失敗して取り消されたら記録も残らない。
 * 代理ログインの社員・運営の組織の人の操作は記録しない(お客さんが使ったことにならない)。
 * 「日」は組織の時間帯で区切る(apps/api/CLAUDE.md のお金と時刻)。
 */
export async function recordUsage(c: Context<AppEnv>, feature: FeatureFlagName): Promise<void> {
  const actor = c.get("actor");
  if (actor.support || actor.tenantId === c.get("supportTenantId")) return;
  const tx = c.get("tx");
  const timeZone = await findTimeZone(tx, actor.tenantId);
  if (timeZone === null) return;
  await tx
    .insert(featureUsage)
    .values({
      tenantId: actor.tenantId,
      userId: actor.userId,
      feature,
      day: toLocalDate(new Date(), timeZone),
    })
    .onConflictDoNothing();
}

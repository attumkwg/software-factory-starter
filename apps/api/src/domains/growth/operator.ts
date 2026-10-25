import { PRE_REGISTRATION_RETENTION_DAYS } from "@app/shared";
import { and, eq, gte, lt, lte, sql } from "drizzle-orm";
import { MANUAL_AUDIT_ACTIONS, recordAudit } from "../../audit/index.ts";
import type { TenantTx } from "../../db/client.ts";
import type { PublicScope } from "./repository.ts";
import { lpDailyCounts, preRegistrations } from "./schema.ts";

// 運営のコマンド(src/pre-registrations/command.ts)と、組織を作るコマンド(G-01 の create-tenant)が使う読み書き。
// どれも運営の組織の文脈(呼ぶ側が開いた withTenant)の tx を受ける。この領域の中では接続プールに触らない。
// **メールアドレス・会社名は返さない**(数と ID だけ。組織にする入力だけは例外で、1件ずつ)。

const DAY = 86_400_000;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export type SourceCounts = {
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  views: number;
  registrations: number;
  confirmations: number;
};

/** 来た所(UTM)ごとの見た数・登録・確認(期間は日本時間の日付。両端を含む) */
export function countsBySource(
  scope: PublicScope,
  range: { from: string; to: string },
): Promise<SourceCounts[]> {
  return scope.tx
    .select({
      utmSource: lpDailyCounts.utmSource,
      utmMedium: lpDailyCounts.utmMedium,
      utmCampaign: lpDailyCounts.utmCampaign,
      views: sql<number>`sum(${lpDailyCounts.views})::int`,
      registrations: sql<number>`sum(${lpDailyCounts.registrations})::int`,
      confirmations: sql<number>`sum(${lpDailyCounts.confirmations})::int`,
    })
    .from(lpDailyCounts)
    .where(
      and(
        eq(lpDailyCounts.tenantId, scope.tenantId),
        gte(lpDailyCounts.day, range.from),
        lte(lpDailyCounts.day, range.to),
      ),
    )
    .groupBy(lpDailyCounts.utmSource, lpDailyCounts.utmMedium, lpDailyCounts.utmCampaign);
}

/** 消す日を過ぎた登録と、残す日数を過ぎた日ごとの数を数える(execute なら消して、監査ログに件数) */
export async function purgeExpired(
  scope: PublicScope,
  opts: { execute: boolean; now: Date },
): Promise<{ today: string; preRegistrations: number; dailyCounts: number }> {
  const today = isoDate(opts.now);
  const countsBefore = isoDate(
    new Date(opts.now.getTime() - PRE_REGISTRATION_RETENTION_DAYS.dailyCounts * DAY),
  );
  const expired = and(
    eq(preRegistrations.tenantId, scope.tenantId),
    lt(preRegistrations.deleteAfter, today),
  );
  const oldCounts = and(
    eq(lpDailyCounts.tenantId, scope.tenantId),
    lt(lpDailyCounts.day, countsBefore),
  );
  if (!opts.execute) {
    const [a] = await scope.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(preRegistrations)
      .where(expired);
    const [b] = await scope.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(lpDailyCounts)
      .where(oldCounts);
    return { today, preRegistrations: a?.n ?? 0, dailyCounts: b?.n ?? 0 };
  }
  const a = await scope.tx
    .delete(preRegistrations)
    .where(expired)
    .returning({ id: preRegistrations.id });
  const b = await scope.tx
    .delete(lpDailyCounts)
    .where(oldCounts)
    .returning({ day: lpDailyCounts.day });
  await recordAudit(scope.tx, {
    tenantId: scope.tenantId,
    actor: { kind: "system", id: null },
    action: MANUAL_AUDIT_ACTIONS.preRegistrationPurged,
    outcome: "allowed",
    details: { preRegistrations: a.length, dailyCounts: b.length },
  });
  return { today, preRegistrations: a.length, dailyCounts: b.length };
}

/** 問い合わせのあったアドレスの登録を数える(execute なら消して、監査ログに登録の ID)。アドレスは返さない */
export async function deleteByEmail(
  scope: PublicScope,
  email: string,
  opts: { execute: boolean },
): Promise<{ found: number }> {
  const match = and(
    eq(preRegistrations.tenantId, scope.tenantId),
    eq(preRegistrations.email, email.trim().toLowerCase()),
  );
  if (!opts.execute) {
    const [r] = await scope.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(preRegistrations)
      .where(match);
    return { found: r?.n ?? 0 };
  }
  const gone = await scope.tx
    .delete(preRegistrations)
    .where(match)
    .returning({ id: preRegistrations.id });
  for (const row of gone) {
    await recordAudit(scope.tx, {
      tenantId: scope.tenantId,
      actor: { kind: "system", id: null },
      action: MANUAL_AUDIT_ACTIONS.preRegistrationDeleted,
      target: { type: "pre_registration", id: row.id },
      outcome: "allowed",
    });
  }
  return { found: gone.length };
}

// ── 組織を作るコマンド(G-01 の create-tenant)へのつなぎ。運営の組織の文脈(withTenant)の中で呼ぶ ──

export type PreRegistrationForTenant = {
  preRegistrationId: string;
  /** 組織の名前の案 */
  organizationName: string;
  /** 最初の管理者のメールアドレス */
  adminEmail: string;
};

/**
 * 確認済みの登録を、組織を作るコマンドの入力にする。確認待ち(本人の確認が無い)・もう組織にした登録・無い登録は null。
 * 試しの表示に出し、人が確かめてから組織を作る(作るのは G-01 のコマンド)。
 */
export async function loadPreRegistrationForTenant(
  tx: TenantTx,
  operatorTenantId: string,
  id: string,
): Promise<PreRegistrationForTenant | null> {
  const [row] = await tx
    .select()
    .from(preRegistrations)
    .where(
      and(
        eq(preRegistrations.tenantId, operatorTenantId),
        eq(preRegistrations.id, id),
        eq(preRegistrations.status, "confirmed"),
      ),
    );
  return row
    ? { preRegistrationId: row.id, organizationName: row.organizationName, adminEmail: row.email }
    : null;
}

/**
 * 組織を作ったら converted にして、作った組織の ID を残す(30日で消える)。組織を作るのは別のトランザクション
 * (別の組織の文脈)なので、作った後に失敗してもやり直せるよう、同じ組織で2回呼んでも true。
 */
export async function markPreRegistrationConverted(
  tx: TenantTx,
  operatorTenantId: string,
  id: string,
  tenantId: string,
  now = new Date(),
): Promise<boolean> {
  const done = await tx
    .update(preRegistrations)
    .set({
      status: "converted",
      convertedTenantId: tenantId,
      convertedAt: now,
      deleteAfter: isoDate(
        new Date(now.getTime() + PRE_REGISTRATION_RETENTION_DAYS.converted * DAY),
      ),
    })
    .where(
      and(
        eq(preRegistrations.tenantId, operatorTenantId),
        eq(preRegistrations.id, id),
        eq(preRegistrations.status, "confirmed"),
      ),
    )
    .returning({ id: preRegistrations.id });
  if (done.length > 0) {
    await recordAudit(tx, {
      tenantId: operatorTenantId,
      actor: { kind: "system", id: null },
      action: MANUAL_AUDIT_ACTIONS.preRegistrationConverted,
      target: { type: "pre_registration", id },
      outcome: "allowed",
      details: { convertedTenantId: tenantId },
    });
    return true;
  }
  const [again] = await tx
    .select({ convertedTenantId: preRegistrations.convertedTenantId })
    .from(preRegistrations)
    .where(and(eq(preRegistrations.tenantId, operatorTenantId), eq(preRegistrations.id, id)));
  return again?.convertedTenantId === tenantId;
}

import { PRE_REGISTRATION_RETENTION_DAYS } from "@app/shared";
import { and, eq, gte, lt, lte, sql } from "drizzle-orm";
import { MANUAL_AUDIT_ACTIONS, recordAudit } from "../../audit/index.ts";
import type { RootDb, TenantTx } from "../../db/client.ts";
import { withTenant } from "../../db/tenant.ts";
import { lpDailyCounts, preRegistrations } from "./schema.ts";

// 運営のコマンド pre-registrations-report・pre-registrations-purge・pre-registrations-delete(cli.ts)の中身と、
// 組織を作るコマンド(G-01 の create-tenant)へ渡す関数(設計書 0025 の 5・6。docs/runbooks/pre-registrations.md)。
// 接続は表の持ち主。表は FORCE RLS なので、運営の組織の文脈を付けて読み書きする。
// **メールアドレス・会社名は外に出さない**(出すのは数と率だけ。AI に渡してよいのもここまで。docs/security.md の AI-6)。

const DAY = 86_400_000;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const rate = (num: number, den: number) => (den === 0 ? null : Math.round((num / den) * 1000) / 10);

export type SourceRow = {
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  views: number;
  registrations: number;
  confirmations: number;
  /** 登録 ÷ 見た数(%。見た数が 0 なら null) */
  registrationRate: number | null;
  /** 確認 ÷ 登録(%) */
  confirmationRate: number | null;
};

/** 来た所(UTM)ごとの見た数・登録・確認と率。期間は日本時間の日付(両端を含む) */
export async function preRegistrationReport(
  db: RootDb,
  operatorTenantId: string,
  range: { from: string; to: string },
): Promise<{ from: string; to: string; total: SourceRow; sources: SourceRow[] }> {
  const rows = await withTenant(db, operatorTenantId, (tx) =>
    tx
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
          eq(lpDailyCounts.tenantId, operatorTenantId),
          gte(lpDailyCounts.day, range.from),
          lte(lpDailyCounts.day, range.to),
        ),
      )
      .groupBy(lpDailyCounts.utmSource, lpDailyCounts.utmMedium, lpDailyCounts.utmCampaign),
  );
  const withRates = (r: Omit<SourceRow, "registrationRate" | "confirmationRate">): SourceRow => ({
    ...r,
    registrationRate: rate(r.registrations, r.views),
    confirmationRate: rate(r.confirmations, r.registrations),
  });
  const sources = rows
    .map(withRates)
    .sort((a, b) => b.registrations - a.registrations || b.views - a.views);
  const sum = (k: "views" | "registrations" | "confirmations") =>
    rows.reduce((n, r) => n + r[k], 0);
  const total = withRates({
    utmSource: "(全部)",
    utmMedium: "",
    utmCampaign: "",
    views: sum("views"),
    registrations: sum("registrations"),
    confirmations: sum("confirmations"),
  });
  return { ...range, total, sources };
}

/** 消す日を過ぎた登録と、残す日数を過ぎた日ごとの数を数える(execute なら消す) */
export async function purgePreRegistrations(
  db: RootDb,
  operatorTenantId: string,
  opts: { execute: boolean; now?: Date },
): Promise<{ today: string; preRegistrations: number; dailyCounts: number }> {
  const now = opts.now ?? new Date();
  const today = isoDate(now);
  const countsBefore = isoDate(
    new Date(now.getTime() - PRE_REGISTRATION_RETENTION_DAYS.dailyCounts * DAY),
  );
  return withTenant(db, operatorTenantId, async (tx) => {
    const expired = and(
      eq(preRegistrations.tenantId, operatorTenantId),
      lt(preRegistrations.deleteAfter, today),
    );
    const oldCounts = and(
      eq(lpDailyCounts.tenantId, operatorTenantId),
      lt(lpDailyCounts.day, countsBefore),
    );
    if (!opts.execute) {
      const [a] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(preRegistrations)
        .where(expired);
      const [b] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(lpDailyCounts)
        .where(oldCounts);
      return { today, preRegistrations: a?.n ?? 0, dailyCounts: b?.n ?? 0 };
    }
    const a = await tx
      .delete(preRegistrations)
      .where(expired)
      .returning({ id: preRegistrations.id });
    const b = await tx.delete(lpDailyCounts).where(oldCounts).returning({ day: lpDailyCounts.day });
    await recordAudit(tx, {
      tenantId: operatorTenantId,
      actor: { kind: "system", id: null },
      action: MANUAL_AUDIT_ACTIONS.preRegistrationPurged,
      outcome: "allowed",
      details: { preRegistrations: a.length, dailyCounts: b.length },
    });
    return { today, preRegistrations: a.length, dailyCounts: b.length };
  });
}

/** 問い合わせを受けて、そのアドレスの登録を数える(execute なら消す)。アドレスは出さない */
export async function deletePreRegistrationByEmail(
  db: RootDb,
  operatorTenantId: string,
  email: string,
  opts: { execute: boolean },
): Promise<{ found: number }> {
  const match = and(
    eq(preRegistrations.tenantId, operatorTenantId),
    eq(preRegistrations.email, email.trim().toLowerCase()),
  );
  return withTenant(db, operatorTenantId, async (tx) => {
    if (!opts.execute) {
      const [r] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(preRegistrations)
        .where(match);
      return { found: r?.n ?? 0 };
    }
    const gone = await tx
      .delete(preRegistrations)
      .where(match)
      .returning({ id: preRegistrations.id });
    for (const row of gone) {
      await recordAudit(tx, {
        tenantId: operatorTenantId,
        actor: { kind: "system", id: null },
        action: MANUAL_AUDIT_ACTIONS.preRegistrationDeleted,
        target: { type: "pre_registration", id: row.id },
        outcome: "allowed",
      });
    }
    return { found: gone.length };
  });
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

// ── コマンドの入口(cli.ts)。引数を読み、出す行(JSON 1行+案内)を返す。接続を開く・閉じるのは cli.ts ──

/** pre-registrations-report [--from YYYY-MM-DD] [--to YYYY-MM-DD](既定は今日までの28日) */
export function parseReportArgs(args: string[], now = new Date()): { from: string; to: string } {
  const value = (flag: string) => {
    const at = args.indexOf(flag);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const to = value("--to") ?? isoDate(now);
  const from = value("--from") ?? isoDate(new Date(Date.parse(to) - 27 * DAY));
  if (!DATE.test(from) || !DATE.test(to) || from > to) {
    throw new Error("使い方: pre-registrations-report [--from YYYY-MM-DD] [--to YYYY-MM-DD]");
  }
  return { from, to };
}

export async function runReport(db: RootDb, operatorTenantId: string, args: string[]) {
  const report = await preRegistrationReport(db, operatorTenantId, parseReportArgs(args));
  return [JSON.stringify({ mode: "report", ...report })];
}

export async function runPurge(db: RootDb, operatorTenantId: string, args: string[]) {
  const execute = args.includes("--execute");
  const r = await purgePreRegistrations(db, operatorTenantId, { execute });
  const lines = [JSON.stringify({ mode: execute ? "purged" : "plan", ...r })];
  if (!execute) lines.push("まだ消していません。数を確かめて --execute を付けて流してください");
  return lines;
}

export async function runDelete(
  db: RootDb,
  operatorTenantId: string,
  email: string,
  args: string[],
) {
  if (!email.includes("@")) throw new Error("メールアドレスを1行で入れてください");
  const execute = args.includes("--execute");
  const r = await deletePreRegistrationByEmail(db, operatorTenantId, email, { execute });
  const lines = [JSON.stringify({ mode: execute ? "deleted" : "plan", ...r })];
  if (!execute && r.found > 0) {
    lines.push("まだ消していません。--execute を付けて、もう一度アドレスを入れてください");
  }
  return lines;
}

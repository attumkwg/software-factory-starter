import {
  OPERATOR_TIME_ZONE,
  PMF_SURVEY_ANSWERS,
  type PmfSurveyAnswer,
  pmfSurveyRound,
  toLocalDate,
} from "@app/shared";
import { and, eq, lt, sql } from "drizzle-orm";
import type { RootDb } from "../db/client.ts";
import { withTenant } from "../db/tenant.ts";
import { allTenantIds, USAGE_RETENTION_DAYS } from "../usage/index.ts";
import { pmfSurveyAsked, pmfSurveyCounts } from "./schema.ts";

// 運営のコマンド pmf-survey-report・pmf-survey-purge(cli.ts)の中身(docs/runbooks/pmf-survey.md)。
// 接続は表の持ち主。表は FORCE RLS なので、組織ごとに文脈を付けて読み、数だけをまとめる。
// **組織の ID・名前・人の ID は外に出さない**(出すのは全部の組織を足した数だけ)。

/** 「とても困る」の割合の目安(Sean Ellis のテスト。docs/guides/before-pmf.md の「PMF の兆し」) */
export const PMF_SURVEY_LINE = 40;
/** 割合で判断するのに足りる答えの数の目安。これより少なければ small: true(割合だけで判断しない) */
export const PMF_SURVEY_SMALL_BELOW = 30;

export type PmfSurveyReport = {
  round: string;
  /** 1件でも答えがあった組織の数(運営の組織は除く) */
  tenantsAnswered: number;
  counts: Record<PmfSurveyAnswer, number>;
  /** 割合の分母: とても困る・少し困る・困らない(もう使っていない・答えないは入れない) */
  answered: number;
  /** とても困る ÷ answered(%・小数1桁)。answered が0なら null */
  veryDisappointedPercent: number | null;
  line: number;
  small: boolean;
};

const zeroCounts = () =>
  Object.fromEntries(PMF_SURVEY_ANSWERS.map((a) => [a, 0])) as Record<PmfSurveyAnswer, number>;

/** その回の答えの数(全部の組織を足す。運営の組織は除く) */
export async function pmfSurveyReport(
  db: RootDb,
  opts: { round?: string; supportTenantId: string | null; now?: Date },
): Promise<PmfSurveyReport> {
  // 回を渡さなければ、いまの回(運営の時間帯の日付。仕様 0087。組織ごとの時間帯の差は四半期の境目の数時間だけ)
  const round =
    opts.round ?? pmfSurveyRound(toLocalDate(opts.now ?? new Date(), OPERATOR_TIME_ZONE));
  const counts = zeroCounts();
  let tenantsAnswered = 0;
  for (const tenantId of await allTenantIds(db)) {
    if (tenantId === opts.supportTenantId) continue;
    const rows = await withTenant(db, tenantId, (tx) =>
      tx
        .select({ answer: pmfSurveyCounts.answer, count: pmfSurveyCounts.count })
        .from(pmfSurveyCounts)
        .where(and(eq(pmfSurveyCounts.tenantId, tenantId), eq(pmfSurveyCounts.round, round))),
    );
    if (rows.length > 0) tenantsAnswered += 1;
    for (const r of rows) {
      if (r.answer in counts) counts[r.answer as PmfSurveyAnswer] += r.count;
    }
  }
  const answered =
    counts.very_disappointed + counts.somewhat_disappointed + counts.not_disappointed;
  return {
    round,
    tenantsAnswered,
    counts,
    answered,
    veryDisappointedPercent:
      answered === 0 ? null : Math.round((counts.very_disappointed / answered) * 1000) / 10,
    line: PMF_SURVEY_LINE,
    small: answered < PMF_SURVEY_SMALL_BELOW,
  };
}

/** 保存期間(利用の記録と同じ 400日)を過ぎた「聞き終えた印」を数える(execute なら消す)。数(counts)は人を持たないので残す */
export async function purgePmfSurveyAsked(
  db: RootDb,
  opts: { execute: boolean; now?: Date },
): Promise<{ before: string; count: number }> {
  const now = opts.now ?? new Date();
  const before = new Date(now.getTime() - USAGE_RETENTION_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  let count = 0;
  for (const tenantId of await allTenantIds(db)) {
    const old = and(eq(pmfSurveyAsked.tenantId, tenantId), lt(pmfSurveyAsked.day, before));
    count += await withTenant(db, tenantId, async (tx) => {
      if (opts.execute) {
        return (await tx.delete(pmfSurveyAsked).where(old).returning({ id: pmfSurveyAsked.id }))
          .length;
      }
      const r = await tx.select({ n: sql<number>`count(*)::int` }).from(pmfSurveyAsked).where(old);
      return r[0]?.n ?? 0;
    });
  }
  return { before, count };
}

// ── コマンドの入口(cli.ts)。出す行を返す。接続を開く・閉じるのは cli.ts ──

const ROUND = /^\d{4}-Q[1-4]$/;

/** pmf-survey-report [--round 2026-Q4] */
export async function runPmfSurveyReport(
  db: RootDb,
  args: string[],
  opts: { supportTenantId: string | null; now?: Date },
): Promise<string[]> {
  const at = args.indexOf("--round");
  const round = at >= 0 ? args[at + 1] : undefined;
  if (round !== undefined && !ROUND.test(round)) {
    throw new Error("使い方: pmf-survey-report [--round 2026-Q4]");
  }
  const report = await pmfSurveyReport(db, { round, ...opts });
  const lines = [JSON.stringify({ mode: "report", ...report })];
  if (report.small) {
    lines.push(
      `答えが ${report.answered} 件です。${PMF_SURVEY_SMALL_BELOW} 件より少ないうちは、割合だけで判断しないでください`,
    );
  }
  return lines;
}

/** pmf-survey-purge [--execute] */
export async function runPmfSurveyPurge(
  db: RootDb,
  args: string[],
  opts: { now?: Date } = {},
): Promise<string[]> {
  const execute = args.includes("--execute");
  const done = await purgePmfSurveyAsked(db, { execute, ...opts });
  const line = JSON.stringify({
    mode: execute ? "purged" : "plan",
    days: USAGE_RETENTION_DAYS,
    ...done,
  });
  return execute
    ? [line]
    : [line, "まだ消していません。件数を確かめて --execute を付けて流してください"];
}

import {
  type FeatureFlagName,
  type PmfSurveyAnswer,
  type PmfSurveyStatus,
  pmfSurveyRound,
  toLocalDate,
} from "@app/shared";
import { and, eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import { findTimeZone, findUserSince } from "../domains/organizations/index.ts";
import type { AppEnv } from "../env.ts";
import { conflict, notFound } from "../errors.ts";
import { isFeatureEnabled } from "../feature-flags/index.ts";
import { pmfSurveyAsked, pmfSurveyCounts } from "./schema.ts";

// 「無くなったら困るか」を聞く(docs/specs/0046-pmf-survey.md)。リクエストの中では c.var.tx(組織の文脈つき)で読む。

export const PMF_SURVEY_FLAG = "pmf-survey" satisfies FeatureFlagName;
/** 使い始めてこの日数がたった人にだけ聞く(使う前の人の「困らない」を数えない) */
export const PMF_SURVEY_MIN_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

type Asking = { round: string; day: string; canAsk: boolean };

/**
 * この人に、いまの回を聞いてよいか。聞かない: 機能フラグが入っていない組織・代理の社員・運営の組織の人・
 * 使い始めて14日より前の人・この回にもう答えた人。
 */
async function asking(c: Context<AppEnv>, now: Date): Promise<Asking | null> {
  const actor = c.get("actor");
  const tx = c.get("tx");
  const timeZone = await findTimeZone(tx, actor.tenantId);
  if (timeZone === null) return null;
  const day = toLocalDate(now, timeZone);
  const round = pmfSurveyRound(day);
  const enabled = await isFeatureEnabled(
    tx,
    actor.tenantId,
    c.get("featureFlags"),
    PMF_SURVEY_FLAG,
  );
  if (!enabled || actor.support || actor.tenantId === c.get("supportTenantId")) {
    return { round, day, canAsk: false };
  }
  const since = await findUserSince(tx, actor.tenantId, actor.userId);
  if (since === null || now.getTime() - since.getTime() < PMF_SURVEY_MIN_DAYS * DAY_MS) {
    return { round, day, canAsk: false };
  }
  const [done] = await tx
    .select({ id: pmfSurveyAsked.id })
    .from(pmfSurveyAsked)
    .where(
      and(
        eq(pmfSurveyAsked.tenantId, actor.tenantId),
        eq(pmfSurveyAsked.userId, actor.userId),
        eq(pmfSurveyAsked.round, round),
      ),
    );
  return { round, day, canAsk: done === undefined };
}

/** GET /api/pmf-survey: いまこの人に聞くか(聞かないときも 200 で ask: false。出していない機能があることを知らせない) */
export async function surveyStatus(c: Context<AppEnv>, now = new Date()): Promise<PmfSurveyStatus> {
  const a = await asking(c, now);
  return { ask: a?.canAsk ?? false, round: a?.round ?? "" };
}

/**
 * POST /api/pmf-survey: 答えを数に1つ足し、この人にこの回は聞き終えた印を付ける(同じトランザクション)。
 * 聞けない人(フラグが無い・代理・運営・使い始めたばかり)は 404、この回にもう答えた人は 409。
 * **だれが何と答えたかは残さない**(印には答えを書かず、数には人を書かない)。
 */
export async function recordAnswer(
  c: Context<AppEnv>,
  answer: PmfSurveyAnswer,
  now = new Date(),
): Promise<void> {
  const a = await asking(c, now);
  if (a === null) throw notFound();
  const actor = c.get("actor");
  const tx = c.get("tx");
  if (!a.canAsk) {
    const [done] = await tx
      .select({ id: pmfSurveyAsked.id })
      .from(pmfSurveyAsked)
      .where(
        and(
          eq(pmfSurveyAsked.tenantId, actor.tenantId),
          eq(pmfSurveyAsked.userId, actor.userId),
          eq(pmfSurveyAsked.round, a.round),
        ),
      );
    throw done ? conflict() : notFound();
  }
  const marked = await tx
    .insert(pmfSurveyAsked)
    .values({ tenantId: actor.tenantId, userId: actor.userId, round: a.round, day: a.day })
    .onConflictDoNothing()
    .returning({ id: pmfSurveyAsked.id });
  // 同時に2回押した: 先に入った方だけ数える
  if (marked.length === 0) throw conflict();
  await tx
    .insert(pmfSurveyCounts)
    .values({ tenantId: actor.tenantId, round: a.round, answer, count: 1 })
    .onConflictDoUpdate({
      target: [pmfSurveyCounts.tenantId, pmfSurveyCounts.round, pmfSurveyCounts.answer],
      set: { count: sql`${pmfSurveyCounts.count} + 1` },
    });
}

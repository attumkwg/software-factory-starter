import { z } from "zod";

// 「このサービスが使えなくなったら、どう感じますか」を画面の中で聞く(PMF の兆し。docs/specs/0046-pmf-survey.md)。
// 答えは数だけを数える(だれが何と答えたかは残さない)。聞くのは機能フラグ pmf-survey を入れた組織の人に、四半期に1回まで。

/** 答え。skipped は「答えない」を選んだ(その四半期はもう聞かない) */
export const PMF_SURVEY_ANSWERS = [
  "very_disappointed",
  "somewhat_disappointed",
  "not_disappointed",
  "not_using",
  "skipped",
] as const;
export const PmfSurveyAnswerSchema = z.enum(PMF_SURVEY_ANSWERS);
export type PmfSurveyAnswer = z.infer<typeof PmfSurveyAnswerSchema>;

/** 画面に出す文(答えの順) */
export const PMF_SURVEY_QUESTION = "このサービスが使えなくなったら、どう感じますか";
export const PMF_SURVEY_LABELS: Readonly<Record<Exclude<PmfSurveyAnswer, "skipped">, string>> = {
  very_disappointed: "とても困る",
  somewhat_disappointed: "少し困る",
  not_disappointed: "困らない",
  not_using: "もう使っていない",
};

/** GET /api/pmf-survey: いまこの人に聞くか。round は「2026-Q4」の形(組織の時間帯の四半期) */
export const PmfSurveyStatusSchema = z.object({
  ask: z.boolean(),
  round: z.string(),
});
export type PmfSurveyStatus = z.infer<typeof PmfSurveyStatusSchema>;

/** POST /api/pmf-survey */
export const PmfSurveyResponseSchema = z.object({ answer: PmfSurveyAnswerSchema });
export type PmfSurveyResponse = z.infer<typeof PmfSurveyResponseSchema>;

/** 日付(YYYY-MM-DD。組織の時間帯)から、聞く回の名前(四半期)。 */
export function pmfSurveyRound(localDate: string): string {
  const [year, month] = localDate.split("-");
  return `${year}-Q${Math.ceil(Number(month) / 3)}`;
}

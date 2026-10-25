import { describe, expect, it } from "vitest";
import { PMF_SURVEY_ANSWERS, PMF_SURVEY_LABELS, pmfSurveyRound } from "./pmf-survey.ts";

describe("PMF の兆しを聞く", () => {
  it("聞く回は四半期(組織の時間帯の日付から)", () => {
    expect(pmfSurveyRound("2026-01-01")).toBe("2026-Q1");
    expect(pmfSurveyRound("2026-03-31")).toBe("2026-Q1");
    expect(pmfSurveyRound("2026-04-01")).toBe("2026-Q2");
    expect(pmfSurveyRound("2026-12-31")).toBe("2026-Q4");
  });

  it("画面の文は、答えない(skipped)以外の全部にある", () => {
    expect(Object.keys(PMF_SURVEY_LABELS).sort()).toEqual(
      PMF_SURVEY_ANSWERS.filter((a) => a !== "skipped").sort(),
    );
  });
});

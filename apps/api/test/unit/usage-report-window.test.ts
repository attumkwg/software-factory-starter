import { describe, expect, it } from "vitest";
import { reportWindow } from "../../src/usage/command.ts";

// 利用の数のコマンドが数える期間(仕様 0087)。「今日」は運営の時間帯(日本時間)で決める。
// 記録の day は組織の時間帯の日付なので、UTC の日付で区切ると日本の朝 0〜9時が前の日・前の週に入る。

describe("usage-report の期間", () => {
  it("日本時間の月曜 8時(UTC ではまだ日曜)は、今週を月曜からとして数える", () => {
    const mondayMorningInTokyo = new Date("2026-10-25T23:00:00Z"); // 日本時間 10/26(月)8:00
    expect(reportWindow(mondayMorningInTokyo, 4)).toEqual({
      since: "2026-10-05",
      until: "2026-10-26",
      cohortsFrom: "2026-10-05",
      lastFullWeek: "2026-10-19",
    });
  });

  it("日本時間の昼なら、UTC の日付と同じ", () => {
    const wednesdayNoon = new Date("2026-10-21T03:00:00Z"); // 日本時間 10/21(水)12:00
    expect(reportWindow(wednesdayNoon, 8)).toEqual({
      since: "2026-08-31",
      until: "2026-10-21",
      cohortsFrom: "2026-08-31",
      lastFullWeek: "2026-10-12",
    });
  });

  it("保存期間の端より前に始めた組は数えない(cohortsFrom は端の週の月曜)", () => {
    const now = new Date("2026-10-21T03:00:00Z");
    expect(reportWindow(now, 60).cohortsFrom).toBe("2025-09-22");
  });
});

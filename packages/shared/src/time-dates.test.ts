import { describe, expect, it } from "vitest";
import { addDays, mondayOf, OPERATOR_TIME_ZONE, toLocalDate } from "./time.ts";

// 日付だけの計算と、運営の「今日」(仕様 0087)。ある瞬間に直さずに日付のまま数える。

describe("日付だけの計算", () => {
  it("addDays は月末・年末・うるう年をまたぐ", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-10-21", -394)).toBe("2025-09-22");
  });

  it("mondayOf は月曜始まり(日曜は前の月曜・月曜はその日)", () => {
    expect(mondayOf("2026-10-25")).toBe("2026-10-19"); // 日曜
    expect(mondayOf("2026-10-26")).toBe("2026-10-26"); // 月曜
    expect(mondayOf("2026-11-01")).toBe("2026-10-26"); // 月をまたぐ
  });

  it("日付でない物は受け付けない", () => {
    expect(() => addDays("2026-10-32", 1)).toThrow();
    expect(() => mondayOf("2026/10/26")).toThrow();
  });
});

describe("運営の今日", () => {
  it("日本時間の 0〜9時も、UTC の前の日にならない", () => {
    expect(toLocalDate(new Date("2026-10-25T23:00:00Z"), OPERATOR_TIME_ZONE)).toBe("2026-10-26");
  });
});

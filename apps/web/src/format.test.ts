import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "./format.ts";

describe("日時の表示は組織の時間帯で", () => {
  // UTC 10/17 15:30 = 日本 10/18 0:30 = ロサンゼルス 10/17 8:30
  const instant = "2026-10-17T15:30:00.000Z";

  it("サーバー(UTC)でもブラウザでも、渡した時間帯の日付になる", () => {
    expect(formatDate(instant, "Asia/Tokyo")).toBe("2026/10/18");
    expect(formatDate(instant, "America/Los_Angeles")).toBe("2026/10/17");
  });

  it("時刻まで出すときも同じ", () => {
    expect(formatDateTime(instant, "Asia/Tokyo")).toContain("0:30");
    expect(formatDateTime(instant, "America/Los_Angeles")).toContain("8:30");
  });
});

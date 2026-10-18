import { describe, expect, it } from "vitest";
import { formatDate } from "./format.ts";

describe("formatDate", () => {
  it("サーバー(UTC)でもブラウザでも、日本時間の日付になる", () => {
    // UTC では 10/17 だが、日本時間では 10/18
    expect(formatDate("2026-10-17T15:30:00.000Z")).toBe("2026/10/18");
  });
});

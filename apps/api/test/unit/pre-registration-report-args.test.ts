import { describe, expect, it } from "vitest";
import { parseReportArgs } from "../../src/pre-registrations/command.ts";

// 事前登録の数のコマンドの期間(docs/specs/0025-public-landing-page.md)。日ごとの数は日本時間の日付で数える。

describe("pre-registrations-report の期間", () => {
  it("既定の終わりは日本時間の今日(日本時間の 0〜9時も、UTC の前日にならない)", () => {
    const justAfterMidnightInTokyo = new Date("2026-10-27T15:30:00Z"); // 日本時間 10/28 0:30
    expect(parseReportArgs([], justAfterMidnightInTokyo)).toEqual({
      from: "2026-10-01",
      to: "2026-10-28",
    });
  });

  it("--from と --to を渡せばそのまま使い、逆さまなら断る", () => {
    expect(parseReportArgs(["--from", "2026-09-01", "--to", "2026-09-30"])).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(() => parseReportArgs(["--from", "2026-10-02", "--to", "2026-10-01"])).toThrow();
  });
});

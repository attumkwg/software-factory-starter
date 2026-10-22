import { describe, expect, it } from "vitest";
import { scrubErrorText, scrubText } from "./scrub-text.ts";

describe("文の伏せ字", () => {
  it("区切りのある電話番号を伏せる。UUID はそのまま", () => {
    expect(scrubText("tel 090-0000-0000 / 03 1234 5678")).toBe("tel [数字] / [数字]");
    const id = "0192f3a4-1234-7abc-8def-0123456789ab";
    expect(scrubText(`id ${id}`)).toBe(`id ${id}`);
  });

  it("ログの文の日本語は残す(コードに書いた固定の文)", () => {
    expect(scrubText("メールを渡しました")).toBe("メールを渡しました");
  });

  it("失敗の文は日本語の並びも伏せる(利用者の名前・題名が入る)", () => {
    expect(
      scrubErrorText("550 <taro@example.com>: rejected: テスト太郎 090-0000-0000 病名テスト"),
    ).toBe("550 <[email]>: rejected: […] [数字] […]");
    expect(scrubErrorText("宛先がありません: tasks.task_completed")).toBe(
      "[…]: tasks.task_completed",
    );
  });
});

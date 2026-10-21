import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./markdown.ts";

describe("parseMarkdown(規約の本文)", () => {
  it("見出し・段落・箇条に分け、注意書き(<!-- -->)は出さない", () => {
    const source = [
      "<!--",
      "運営への注意",
      "-->",
      "",
      "## 第1条(適用)",
      "この規約は、",
      "すべての利用に適用します。",
      "",
      "- 一つ目",
      "- 二つ目",
    ].join("\n");
    expect(parseMarkdown(source)).toEqual([
      { kind: "heading", text: "第1条(適用)" },
      { kind: "paragraph", text: "この規約は、すべての利用に適用します。" },
      { kind: "list", items: ["一つ目", "二つ目"] },
    ]);
  });

  it("HTML やリンクの書き方は文字のまま(差し込まない)", () => {
    expect(parseMarkdown("<b>太字</b> と [リンク](https://example.test)")).toEqual([
      { kind: "paragraph", text: "<b>太字</b> と [リンク](https://example.test)" },
    ]);
  });

  it("CRLF でも、閉じていない注意書きでも読める", () => {
    expect(parseMarkdown("## 見出し\r\n\r\n本文")).toEqual([
      { kind: "heading", text: "見出し" },
      { kind: "paragraph", text: "本文" },
    ]);
    expect(parseMarkdown("本文\n\n<!-- 閉じていない")).toEqual([
      { kind: "paragraph", text: "本文" },
    ]);
  });
});

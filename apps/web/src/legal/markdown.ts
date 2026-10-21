// 規約の本文(Markdown)を、画面の部品で描くための塊に分ける(docs/specs/0009-legal-consent.md)。
// 読むのは「## 見出し」「空行で区切った段落」「- 箇条」だけ。ほかの書き方(表・リンク・強調)は文字のまま出す。
// HTML として差し込まない(dangerouslySetInnerHTML を使わない)。<!-- --> の注意書きは画面に出さない。
// ライブラリを入れないのは、画面の JS の大きさの上限(docs/guides/ci-limits.md)に響くため。

export type Block =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

/** <!-- … --> を落とす(複数行も) */
function stripComments(source: string): string {
  let out = "";
  let rest = source;
  for (;;) {
    const start = rest.indexOf("<!--");
    if (start < 0) return out + rest;
    out += rest.slice(0, start);
    const end = rest.indexOf("-->", start + 4);
    if (end < 0) return out;
    rest = rest.slice(end + 3);
  }
}

/** 空行で区切った1つの塊を読む */
function toBlocks(chunk: string): Block[] {
  const lines = chunk.split("\n").map((l) => l.trim());
  const first = lines[0] ?? "";
  if (first.startsWith("#")) {
    const text = first.replace(/^#+\s*/, "");
    const rest = lines.slice(1).join("\n");
    return [{ kind: "heading", text }, ...(rest ? toBlocks(rest) : [])];
  }
  if (lines.every((l) => l.startsWith("- "))) {
    return [{ kind: "list", items: lines.map((l) => l.slice(2).trim()) }];
  }
  return [{ kind: "paragraph", text: lines.join("") }];
}

export function parseMarkdown(source: string): Block[] {
  return stripComments(source.replaceAll("\r\n", "\n"))
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .flatMap(toBlocks);
}

import { createHash } from "node:crypto";
import { LEGAL_VERSIONS } from "@app/shared";
import { describe, expect, it } from "vitest";
import { legalBody, legalBodyPath, legalBodyPaths } from "./documents.ts";
import { parseMarkdown } from "./markdown.ts";

// 公開した版の本文は変えない(docs/specs/0009-legal-consent.md)。直すときは新しい版のファイルを足し、
// @app/shared の LEGAL_VERSIONS に1行(sha256 はこのテストが落ちたときの文に出る)。

describe("規約の本文", () => {
  it.each(LEGAL_VERSIONS.map((v) => [`${v.document} の版 ${v.version}`, v] as const))(
    "%s: ファイルがあり、sha256 が版の一覧と合う",
    (_, v) => {
      const body = legalBody(v.document, v.version);
      expect(body, `${legalBodyPath(v.document, v.version)} がありません`).toBeDefined();
      const actual = createHash("sha256")
        .update(body ?? "")
        .digest("hex");
      expect(
        actual,
        `本文が版の一覧の sha256 と合いません。公開した版は書き換えず、新しい版を足してください(新しい版なら sha256: "${actual}")`,
      ).toBe(v.sha256);
    },
  );

  it("版の一覧に無い本文のファイルが無い", () => {
    const listed = LEGAL_VERSIONS.map((v) => legalBodyPath(v.document, v.version)).sort();
    expect(legalBodyPaths()).toEqual(listed);
  });

  it("キットのひな形は見出しと「(ここに書く)」だけ(規約の文面を入れない)", () => {
    for (const v of LEGAL_VERSIONS.filter((x) => x.version === 1)) {
      const blocks = parseMarkdown(legalBody(v.document, v.version) ?? "");
      expect(blocks.length).toBeGreaterThan(0);
      for (const b of blocks) {
        if (b.kind !== "heading") expect(b).toEqual({ kind: "paragraph", text: "(ここに書く)" });
      }
    }
  });
});

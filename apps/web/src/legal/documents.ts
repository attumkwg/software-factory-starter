import type { LegalDocument } from "@app/shared";

// 規約の本文(apps/web/src/legal/<文書>/v<版>.md)を、ビルドのときに文字として取り込む。
// 版の一覧(公開・効力の日時・要約・sha256)は @app/shared の LEGAL_VERSIONS(docs/guides/legal-documents.md)。
// 公開した版の本文は変えない(documents.test.ts が sha256 を確かめる)。

const FILES = import.meta.glob<string>("./*/v*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

const pathOf = (document: LegalDocument, version: number) => `./${document}/v${version}.md`;

/** 本文。無ければ undefined */
export function legalBody(document: LegalDocument, version: number): string | undefined {
  return FILES[pathOf(document, version)];
}

/** 取り込んだ本文のファイルの一覧(テスト用) */
export function legalBodyPaths(): string[] {
  return Object.keys(FILES).sort();
}

export { pathOf as legalBodyPath };

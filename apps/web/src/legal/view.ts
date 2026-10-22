import {
  currentVersion,
  LEGAL_DOCUMENT_TITLES,
  LEGAL_VERSIONS,
  LegalDocumentSchema,
  publishedVersions,
} from "@app/shared";
import { pageHead, SITE_NAME } from "../head.ts";
import type { LegalDocumentView } from "../pages/LegalDocumentPage.tsx";
import { legalBody } from "./documents.ts";

/**
 * 本文の画面に出す物(公開前の版・無い文書は undefined = 見つかりません)。
 * version を省くと、いま効いている版。
 */
export function legalDocumentView(
  documentParam: string,
  versionParam?: string,
  now = new Date(),
): LegalDocumentView | undefined {
  const document = LegalDocumentSchema.safeParse(documentParam);
  if (!document.success) return undefined;
  const history = publishedVersions(now, LEGAL_VERSIONS).filter(
    (v) => v.document === document.data,
  );
  const current = currentVersion(document.data, now);
  const version =
    versionParam === undefined ? current : history.find((v) => String(v.version) === versionParam);
  const body = version ? legalBody(version.document, version.version) : undefined;
  if (!version || body === undefined) return undefined;
  return { version, body, history, currentVersion: current?.version };
}

/** 本文の画面の title・説明・OGP(ログイン無しで読める公開の画面。リンクを貼るとカードになる) */
export function legalDocumentHead(documentParam: string, versionParam?: string) {
  const document = LegalDocumentSchema.safeParse(documentParam);
  if (!document.success) return pageHead({ title: "見つかりません" });
  const name = LEGAL_DOCUMENT_TITLES[document.data];
  if (versionParam === undefined) {
    return pageHead({
      title: name,
      description: `${SITE_NAME} の${name}の、いま効いている版の本文と変更の履歴です。`,
      path: `/legal/${document.data}`,
      type: "article",
    });
  }
  return pageHead({
    title: `${name}(版 ${versionParam})`,
    description: `${SITE_NAME} の${name}の、版 ${versionParam} の本文です。`,
    path: `/legal/${document.data}/${encodeURIComponent(versionParam)}`,
    type: "article",
  });
}

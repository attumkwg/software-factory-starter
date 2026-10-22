import {
  currentVersion,
  LEGAL_VERSIONS,
  LegalDocumentSchema,
  publishedVersions,
} from "@app/shared";
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

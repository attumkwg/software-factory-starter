import { z } from "zod";
import { InstantSchema } from "./time.ts";

// 利用規約・プライバシーポリシーの版(docs/specs/0008-legal-consent.md・ADR 0019)。
// 本文は apps/web/src/legal/<文書>/v<版>.md。**版を足すのは PR で**(手順は docs/guides/legal-documents.md)。
// 画面(本文・登録・帯)と API(関所・同意の検証)が、この一覧を同じに見る。
//
// 決まり(legal.test.ts と apps/web/src/legal/documents.test.ts が確かめる):
// - 版は文書ごとに 1 から抜けなく続く。1つ目は reconsent: true(最初は全員に同意してもらう)
// - effectiveAt ≥ publishedAt。2つ目からは LEGAL_NOTICE_DAYS 日以上あける
// - 公開した版の本文は変えない(sha256 が合わなくなる)。直すときは新しい版

export const LEGAL_DOCUMENTS = ["terms", "privacy"] as const;
export const LegalDocumentSchema = z.enum(LEGAL_DOCUMENTS);
export type LegalDocument = z.infer<typeof LegalDocumentSchema>;

/** 画面とメールに出す文書の名前 */
export const LEGAL_DOCUMENT_TITLES: Readonly<Record<LegalDocument, string>> = {
  terms: "利用規約",
  privacy: "プライバシーポリシー",
};

/** 2つ目からの版で、公開から効力までにあける日数(docs/designs/0008-legal-consent.md の U-2) */
export const LEGAL_NOTICE_DAYS = 30;

export type LegalVersion = {
  document: LegalDocument;
  /** 文書ごとに 1, 2, 3 … */
  version: number;
  /** この時刻から画面に出る・帯が出る・お知らせを送れる(時差つきの ISO 8601) */
  publishedAt: string;
  /** この時刻から効く。reconsent なら、同意していない人を関所が止め始める */
  effectiveAt: string;
  /** 変更の要約(帯・同意の画面・メール・履歴に出る) */
  summary: string;
  /** 同意し直しが要るか(利用者に不利になりうる変更・利用目的を広げる変更など。U-1) */
  reconsent: boolean;
  /** 本文の Markdown の SHA-256(16進) */
  sha256: string;
};

export const LEGAL_VERSIONS: readonly LegalVersion[] = [
  {
    document: "terms",
    version: 1,
    publishedAt: "2026-10-22T00:00:00+09:00",
    effectiveAt: "2026-10-22T00:00:00+09:00",
    summary: "最初の版",
    reconsent: true,
    sha256: "e6355295480da38a261a1bd715b3d988d594d50ef443995ab38698184a4034f6",
  },
  {
    document: "privacy",
    version: 1,
    publishedAt: "2026-10-22T00:00:00+09:00",
    effectiveAt: "2026-10-22T00:00:00+09:00",
    summary: "最初の版",
    reconsent: true,
    sha256: "2cb1d4816086b2c5d0727a984e34aeacf0883dff4e675f5f0978f7fef23c3101",
  },
];

/** 文書と版の組(同意する・同意が要る) */
export const LegalVersionRefSchema = z.object({
  document: LegalDocumentSchema,
  version: z.number().int().positive(),
});
export type LegalVersionRef = z.infer<typeof LegalVersionRefSchema>;

/** 同意する(POST /api/legal/consents)。同じ文書は1つだけ */
export const LegalConsentRequestSchema = z.object({
  consents: z
    .array(LegalVersionRefSchema)
    .min(1)
    .max(LEGAL_DOCUMENTS.length)
    .refine((list) => new Set(list.map((c) => c.document)).size === list.length, {
      message: "同じ文書が2つあります",
    }),
});
export type LegalConsentRequest = z.infer<typeof LegalConsentRequestSchema>;

/**
 * 本人の同意の状態(GET /api/me の legal)。
 *   pending  … 効いている「同意し直しが要る版」に、まだ同意していない(画面は同意の画面へ回す・API は 403)
 *   upcoming … 公開済みでまだ効いていない版(画面は帯を出す)。accepted なら前もって同意済み
 */
export const LegalStatusSchema = z.object({
  pending: z.array(LegalVersionRefSchema),
  upcoming: z.array(
    LegalVersionRefSchema.extend({
      effectiveAt: InstantSchema,
      summary: z.string(),
      reconsent: z.boolean(),
      accepted: z.boolean(),
    }),
  ),
});
export type LegalStatus = z.infer<typeof LegalStatusSchema>;

/** 文書ごとの「同意した最大の版」 */
export type AcceptedVersions = Partial<Record<LegalDocument, number>>;

const at = (iso: string) => new Date(iso).getTime();

/** 公開済みの版(古い順) */
export function publishedVersions(
  now: Date,
  versions: readonly LegalVersion[] = LEGAL_VERSIONS,
): LegalVersion[] {
  return versions
    .filter((v) => at(v.publishedAt) <= now.getTime())
    .sort((a, b) => a.version - b.version);
}

/** いま効いている版(その文書の、効力の日を過ぎた最新)。無ければ undefined */
export function currentVersion(
  document: LegalDocument,
  now: Date,
  versions: readonly LegalVersion[] = LEGAL_VERSIONS,
): LegalVersion | undefined {
  return publishedVersions(now, versions)
    .filter((v) => v.document === document && at(v.effectiveAt) <= now.getTime())
    .at(-1);
}

/** 同意してよい版か(公開済みで、いまの版かそれより後の版) */
export function canAccept(
  ref: LegalVersionRef,
  now: Date,
  versions: readonly LegalVersion[] = LEGAL_VERSIONS,
): boolean {
  const published = publishedVersions(now, versions).some(
    (v) => v.document === ref.document && v.version === ref.version,
  );
  const current = currentVersion(ref.document, now, versions)?.version ?? 0;
  return published && ref.version >= current;
}

/** 本人の同意の状態。accepted は文書ごとの「同意した最大の版」(後の版への同意は前の版を含む) */
export function legalStatus(
  accepted: AcceptedVersions,
  now: Date,
  versions: readonly LegalVersion[] = LEGAL_VERSIONS,
): LegalStatus {
  const t = now.getTime();
  const published = publishedVersions(now, versions);
  const pending = LEGAL_DOCUMENTS.flatMap((document) => {
    const required = published
      .filter((v) => v.document === document && v.reconsent && at(v.effectiveAt) <= t)
      .at(-1);
    if (!required || (accepted[document] ?? 0) >= required.version) return [];
    return [{ document, version: required.version }];
  });
  const upcoming = published
    .filter((v) => at(v.effectiveAt) > t)
    .map((v) => ({
      document: v.document,
      version: v.version,
      effectiveAt: new Date(v.effectiveAt).toISOString(),
      summary: v.summary,
      reconsent: v.reconsent,
      accepted: (accepted[v.document] ?? 0) >= v.version,
    }));
  return { pending, upcoming };
}

/** 1つの版の決まりに合わない所。index は文書の中で何番目か(0 から) */
function versionProblems(v: LegalVersion, index: number): string[] {
  const name = `${v.document} の版 ${v.version}`;
  const days = (at(v.effectiveAt) - at(v.publishedAt)) / 86_400_000;
  const checks: [boolean, string][] = [
    [v.version !== index + 1, "版は 1 から抜けなく並べる"],
    [Number.isNaN(days), "時刻が読めない"],
    [days < 0, "効力が公開より前"],
    [index === 0 && !v.reconsent, "最初の版は同意し直し(reconsent)にする"],
    [
      index > 0 && days >= 0 && days < LEGAL_NOTICE_DAYS,
      `公開から効力まで ${LEGAL_NOTICE_DAYS} 日以上あける(いま ${days} 日)`,
    ],
    [!/^[0-9a-f]{64}$/.test(v.sha256), "sha256 は16進の64文字"],
  ];
  return checks.filter(([bad]) => bad).map(([, problem]) => `${name}: ${problem}`);
}

/** 版の一覧の決まりに合わない所(空なら合っている)。単体テストが本物の一覧に当てる */
export function legalVersionProblems(versions: readonly LegalVersion[]): string[] {
  return LEGAL_DOCUMENTS.flatMap((document) =>
    versions.filter((v) => v.document === document).flatMap(versionProblems),
  );
}

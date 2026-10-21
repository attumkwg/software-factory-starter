import { describe, expect, it } from "vitest";
import {
  canAccept,
  currentVersion,
  LEGAL_VERSIONS,
  LegalConsentRequestSchema,
  type LegalVersion,
  legalStatus,
  legalVersionProblems,
  publishedVersions,
} from "./legal.ts";

const hash = "0".repeat(64);
const v = (over: Partial<LegalVersion> & Pick<LegalVersion, "document" | "version">) => ({
  publishedAt: "2026-01-01T00:00:00+09:00",
  effectiveAt: "2026-01-01T00:00:00+09:00",
  summary: "要約",
  reconsent: false,
  sha256: hash,
  ...over,
});

// 利用規約: 1(最初)・2(軽い変更・効いている)・3(同意し直し・予告中)・4(公開前)
const VERSIONS: LegalVersion[] = [
  v({ document: "terms", version: 1, reconsent: true }),
  v({
    document: "terms",
    version: 2,
    publishedAt: "2026-02-01T00:00:00Z",
    effectiveAt: "2026-03-05T00:00:00Z",
  }),
  v({
    document: "terms",
    version: 3,
    publishedAt: "2026-04-01T00:00:00Z",
    effectiveAt: "2026-05-01T00:00:00Z",
    reconsent: true,
  }),
  v({
    document: "terms",
    version: 4,
    publishedAt: "2026-09-01T00:00:00Z",
    effectiveAt: "2026-10-01T00:00:00Z",
  }),
  v({ document: "privacy", version: 1, reconsent: true }),
];
const APRIL = new Date("2026-04-10T00:00:00Z");
const MAY = new Date("2026-05-02T00:00:00Z");

describe("版の一覧(本物)", () => {
  it("決まりに合っている(抜けなし・日付の順・30日・最初は同意し直し)", () => {
    expect(legalVersionProblems(LEGAL_VERSIONS)).toEqual([]);
  });

  it("2つ目からの版で、予告が30日に足りなければ問題になる", () => {
    const short = [
      v({ document: "terms", version: 1, reconsent: true }),
      v({
        document: "terms",
        version: 2,
        publishedAt: "2026-02-01T00:00:00Z",
        effectiveAt: "2026-03-02T00:00:00Z",
      }),
    ];
    expect(legalVersionProblems(short)).toEqual([
      "terms の版 2: 公開から効力まで 30 日以上あける(いま 29 日)",
    ]);
  });

  it("版の抜け・効力が公開より前・最初の版が知らせるだけ、を見つける", () => {
    const bad = [
      v({ document: "privacy", version: 1 }),
      v({
        document: "privacy",
        version: 3,
        publishedAt: "2026-05-01T00:00:00Z",
        effectiveAt: "2026-04-01T00:00:00Z",
      }),
    ];
    expect(legalVersionProblems(bad)).toEqual(
      expect.arrayContaining([
        "privacy の版 1: 最初の版は同意し直し(reconsent)にする",
        "privacy の版 3: 版は 1 から抜けなく並べる",
        "privacy の版 3: 効力が公開より前",
      ]),
    );
  });
});

describe("公開といまの版", () => {
  it("公開の日時より前の版は出さない", () => {
    expect(publishedVersions(APRIL, VERSIONS).map((x) => `${x.document}${x.version}`)).toEqual([
      "terms1",
      "privacy1",
      "terms2",
      "terms3",
    ]);
  });

  it("いまの版は、効力の日を過ぎた最新", () => {
    expect(currentVersion("terms", APRIL, VERSIONS)?.version).toBe(2);
    expect(currentVersion("terms", MAY, VERSIONS)?.version).toBe(3);
  });

  it("同意してよいのは、公開済みで、いまの版かそれより後の版", () => {
    expect(canAccept({ document: "terms", version: 2 }, APRIL, VERSIONS)).toBe(true);
    expect(canAccept({ document: "terms", version: 3 }, APRIL, VERSIONS)).toBe(true);
    expect(canAccept({ document: "terms", version: 1 }, APRIL, VERSIONS)).toBe(false);
    expect(canAccept({ document: "terms", version: 4 }, APRIL, VERSIONS)).toBe(false);
    expect(canAccept({ document: "terms", version: 9 }, APRIL, VERSIONS)).toBe(false);
  });
});

describe("legalStatus(同意が要るか)", () => {
  it("何も同意していなければ、効いている同意し直しの版が要る", () => {
    expect(legalStatus({}, APRIL, VERSIONS).pending).toEqual([
      { document: "terms", version: 1 },
      { document: "privacy", version: 1 },
    ]);
  });

  it("知らせるだけの版(2)が効いても、同意は要らない", () => {
    expect(legalStatus({ terms: 1, privacy: 1 }, APRIL, VERSIONS).pending).toEqual([]);
  });

  it("予告中の版は帯に出る。同意し直しの版に前もって同意していれば accepted", () => {
    const before = legalStatus({ terms: 1, privacy: 1 }, APRIL, VERSIONS);
    expect(before.upcoming).toEqual([
      {
        document: "terms",
        version: 3,
        effectiveAt: "2026-05-01T00:00:00.000Z",
        summary: "要約",
        reconsent: true,
        accepted: false,
      },
    ]);
    expect(legalStatus({ terms: 3, privacy: 1 }, APRIL, VERSIONS).upcoming[0]?.accepted).toBe(true);
  });

  it("同意し直しの版が効いたら、前の版にしか同意していない人は要る。前もって同意した人は要らない", () => {
    expect(legalStatus({ terms: 2, privacy: 1 }, MAY, VERSIONS).pending).toEqual([
      { document: "terms", version: 3 },
    ]);
    expect(legalStatus({ terms: 3, privacy: 1 }, MAY, VERSIONS).pending).toEqual([]);
  });

  it("後の版への同意は、前の版の同意を含む", () => {
    expect(legalStatus({ terms: 4, privacy: 1 }, MAY, VERSIONS).pending).toEqual([]);
  });
});

describe("LegalConsentRequestSchema", () => {
  it("同じ文書が2つ・空は通さない", () => {
    const twice = {
      consents: [
        { document: "terms", version: 1 },
        { document: "terms", version: 2 },
      ],
    };
    expect(LegalConsentRequestSchema.safeParse(twice).success).toBe(false);
    expect(LegalConsentRequestSchema.safeParse({ consents: [] }).success).toBe(false);
    expect(
      LegalConsentRequestSchema.safeParse({ consents: [{ document: "cookie", version: 1 }] })
        .success,
    ).toBe(false);
  });
});

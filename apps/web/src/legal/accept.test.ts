import type { LegalVersion, Me } from "@app/shared";
import { describe, expect, it } from "vitest";
import { acceptItems, agreesForOrganization } from "./accept.ts";

const v = (document: "terms" | "privacy", version: number): LegalVersion => ({
  document,
  version,
  publishedAt: "2026-01-01T00:00:00Z",
  effectiveAt: "2026-02-01T00:00:00Z",
  summary: `${document}${version}`,
  reconsent: true,
  sha256: "0".repeat(64),
});
const VERSIONS = [v("terms", 1), v("terms", 2), v("terms", 3), v("privacy", 1)];
const me = (legal: Me["legal"], role: Me["role"] = "member") => ({ role, legal }) as unknown as Me;
const upcoming = (version: number, over: object = {}) => ({
  document: "terms" as const,
  version,
  effectiveAt: "2026-03-01T00:00:00.000Z",
  summary: "",
  reconsent: true,
  accepted: false,
  ...over,
});

describe("同意の画面に並べる版", () => {
  it("いま要る版と、前もって同意できる版。同じ文書は後の版だけ(要るかは引き継ぐ)", () => {
    const items = acceptItems(
      me({
        pending: [
          { document: "terms", version: 2 },
          { document: "privacy", version: 1 },
        ],
        upcoming: [upcoming(3)],
      }),
      VERSIONS,
    );
    expect(items.map((i) => [i.document, i.version, i.required])).toEqual([
      ["terms", 3, true],
      ["privacy", 1, true],
    ]);
  });

  it("知らせるだけの版・前もって同意済みの版は並べない", () => {
    const items = acceptItems(
      me({
        pending: [],
        upcoming: [upcoming(2, { reconsent: false }), upcoming(3, { accepted: true })],
      }),
      VERSIONS,
    );
    expect(items).toEqual([]);
    expect(acceptItems(me(undefined), VERSIONS)).toEqual([]);
  });

  it("管理者が利用規約に同意するときだけ「組織を代表して」", () => {
    const terms = acceptItems(
      me({ pending: [{ document: "terms", version: 1 }], upcoming: [] }),
      VERSIONS,
    );
    expect(agreesForOrganization(me(undefined, "admin"), terms)).toBe(true);
    expect(agreesForOrganization(me(undefined, "member"), terms)).toBe(false);
    const privacy = acceptItems(
      me({ pending: [{ document: "privacy", version: 1 }], upcoming: [] }),
      VERSIONS,
    );
    expect(agreesForOrganization(me(undefined, "admin"), privacy)).toBe(false);
  });
});

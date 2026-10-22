import { LEGAL_VERSIONS, type LegalVersion } from "@app/shared";
import { describe, expect, it } from "vitest";
import {
  ALLOWED_DURING_MFA_SETUP,
  ALLOWED_DURING_TERMS_ACCEPTANCE,
  can,
  NOT_DURING_SUPPORT,
  ROUTE_RULES,
} from "../../src/authz/policy.ts";
import { capacityOf, noticeProblem } from "../../src/domains/legal/index.ts";

// 規約と同意(docs/specs/0009-legal-consent.md)の、DB の要らない決まり。流れは legal-consent.int.test.ts。

describe("組織としてか本人としてか(capacity)", () => {
  it("利用規約を管理者が同意したら組織として。ほかは本人として", () => {
    expect(capacityOf("admin", "terms")).toBe("organization");
    expect(capacityOf("member", "terms")).toBe("individual");
    expect(capacityOf("viewer", "terms")).toBe("individual");
    expect(capacityOf("admin", "privacy")).toBe("individual");
  });
});

describe("お知らせを送ってよい版(legal-notify)", () => {
  const DAY = 86_400_000;
  const at = (ms: number) => new Date(Date.now() + ms).toISOString();
  const versions: LegalVersion[] = [
    ...LEGAL_VERSIONS,
    {
      document: "terms",
      version: 2,
      publishedAt: at(-DAY),
      effectiveAt: at(29 * DAY),
      summary: "要約",
      reconsent: false,
      sha256: "0".repeat(64),
    },
    {
      document: "terms",
      version: 3,
      publishedAt: at(DAY),
      effectiveAt: at(40 * DAY),
      summary: "要約",
      reconsent: false,
      sha256: "0".repeat(64),
    },
  ];
  const now = new Date();

  it("公開済みで、まだ効いていない版だけ送れる", () => {
    expect(noticeProblem({ document: "terms", version: 2 }, now, versions)).toBeNull();
  });

  it("無い版・公開前の版・もう効いている版は止める", () => {
    expect(noticeProblem({ document: "terms", version: 9 }, now, versions)).toBe(
      "版の一覧にありません",
    );
    expect(noticeProblem({ document: "terms", version: 3 }, now, versions)).toBe(
      "公開前か、古い版です",
    );
    expect(noticeProblem({ document: "privacy", version: 1 }, now, versions)).toBe(
      "もう効いている版です(予告になりません)",
    );
  });
});

describe("関所の決まり(policy.ts)", () => {
  it("同意待ちの間に通る API は、決まりのある API で、同意の API を含む", () => {
    for (const route of ALLOWED_DURING_TERMS_ACCEPTANCE) expect(ROUTE_RULES[route]).toBeDefined();
    expect(ALLOWED_DURING_TERMS_ACCEPTANCE.has("POST /api/legal/consents")).toBe(true);
    // 書き込みの API(プロジェクトを作るなど)は入っていない
    expect(ALLOWED_DURING_TERMS_ACCEPTANCE.has("POST /api/projects")).toBe(false);
    expect(ALLOWED_DURING_MFA_SETUP.has("POST /api/legal/consents")).toBe(false);
  });

  it("同意は全員ができ、代理の社員はできない", () => {
    expect(ROUTE_RULES["POST /api/legal/consents"]).toBe("legal:accept");
    for (const role of ["admin", "member", "viewer"] as const) {
      expect(can(role, "legal:accept")).toBe(true);
    }
    expect(NOT_DURING_SUPPORT.has("legal:accept")).toBe(true);
  });
});

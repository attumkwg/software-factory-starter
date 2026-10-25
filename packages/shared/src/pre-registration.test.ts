import { describe, expect, it } from "vitest";
import {
  currentPreRegistrationConsent,
  normalizeLandingPath,
  normalizeUtm,
  PRE_REGISTRATION_CONSENTS,
  PreRegistrationRequestSchema,
} from "./pre-registration.ts";

// 公開の LP の事前登録(docs/specs/0025-public-landing-page.md)

describe("同意の文", () => {
  it("版は 1 から抜けなく並び、いまの版は最後の版", () => {
    PRE_REGISTRATION_CONSENTS.forEach((c, i) => {
      expect(c.version).toBe(i + 1);
    });
    expect(currentPreRegistrationConsent()).toBe(PRE_REGISTRATION_CONSENTS.at(-1));
  });

  it("何に使うか・いつ消すか・どこで消せるかが書いてある", () => {
    const { text } = currentPreRegistrationConsent();
    expect(text).toContain("だけ使います");
    expect(text).toContain("消します");
    expect(text).toContain("いつでも消せます");
  });

  it("同意のチェックが true でなければ通らない", () => {
    const base = {
      email: "lead@example.test",
      organizationName: "サンプル商事(架空)",
      consentTextVersion: 1,
    };
    expect(PreRegistrationRequestSchema.safeParse({ ...base, consent: true }).success).toBe(true);
    expect(PreRegistrationRequestSchema.safeParse({ ...base, consent: false }).success).toBe(false);
    expect(PreRegistrationRequestSchema.safeParse(base).success).toBe(false);
  });
});

describe("UTM とページの path を整える", () => {
  it("英数と -_. だけ・100文字まで。外れたら空", () => {
    expect(normalizeUtm("koumuten-kai_2026.11")).toBe("koumuten-kai_2026.11");
    expect(normalizeUtm("someone@example.test")).toBe("");
    expect(normalizeUtm("工務店")).toBe("");
    expect(normalizeUtm("a".repeat(101))).toBe("");
    expect(normalizeUtm(undefined)).toBe("");
  });

  it("path はクエリと # を落とす。外れたら /", () => {
    expect(normalizeLandingPath("/pricing?utm_source=x#top")).toBe("/pricing");
    expect(normalizeLandingPath("https://evil.example/")).toBe("/");
    expect(normalizeLandingPath("/<script>")).toBe("/");
    expect(normalizeLandingPath(undefined)).toBe("/");
  });
});

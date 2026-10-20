import { otpauthUri } from "@app/shared";
import { describe, expect, it } from "vitest";
import { openReauth, REAUTH_TTL_SECONDS, sealReauth } from "../../src/auth/reauth.ts";
import type { SessionConfig } from "../../src/auth/session.ts";
import { maskEmail } from "../../src/domains/organizations/notifications.ts";

// 確かめ直しの札(ADR 0016): 暗号化・本人に結びつく・10分で切れる・書き換えられない

const cfg: SessionConfig = {
  secret: "s".repeat(32),
  idleSeconds: 3600,
  maxSeconds: 43200,
  secureCookie: false,
};
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const TOKEN = "eyJhbGciOiJSUzI1NiJ9.access.token";
const T0 = 1_800_000_000_000;

describe("確かめ直しの札", () => {
  it("中身(アクセストークン)は暗号化され、Cookie の値から読めない", () => {
    const sealed = sealReauth(cfg, { userId: USER, accessToken: TOKEN }, T0);
    expect(sealed).not.toContain("eyJ");
    expect(Buffer.from(sealed, "base64url").toString("latin1")).not.toContain("access.token");
    expect(openReauth(cfg, sealed, USER, T0)).toEqual({ userId: USER, accessToken: TOKEN });
  });

  it("本人違い・切れた・書き換えた・別の鍵では開かない", () => {
    const sealed = sealReauth(cfg, { userId: USER, accessToken: TOKEN }, T0);
    expect(openReauth(cfg, sealed, OTHER, T0)).toBeNull();
    expect(openReauth(cfg, sealed, USER, T0 + REAUTH_TTL_SECONDS * 1000)).toBeNull();
    const raw = Buffer.from(sealed, "base64url");
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 1;
    expect(openReauth(cfg, raw.toString("base64url"), USER, T0)).toBeNull();
    expect(openReauth({ ...cfg, secret: "t".repeat(32) }, sealed, USER, T0)).toBeNull();
    expect(openReauth(cfg, "not-a-ticket", USER, T0)).toBeNull();
  });

  it("同じ中身でも毎回違う値になる(nonce)", () => {
    const r = { userId: USER, accessToken: TOKEN };
    expect(sealReauth(cfg, r, T0)).not.toBe(sealReauth(cfg, r, T0));
  });
});

describe("お知らせと認証アプリ", () => {
  it("古いアドレスへのお知らせでは、新しいアドレスを伏せる", () => {
    expect(maskEmail("renamed@example.co.jp")).toBe("r***@e***.jp");
    expect(maskEmail("a@b")).toBe("a***@b***");
  });

  it("認証アプリに読ませる URI は、発行者とメールと鍵を持つ", () => {
    const uri = otpauthUri("me+x@acme.test", "ABCDEF234567");
    expect(uri).toBe(
      "otpauth://totp/Tasks%3Ame%2Bx%40acme.test?secret=ABCDEF234567&issuer=Tasks&algorithm=SHA1&digits=6&period=30",
    );
  });
});

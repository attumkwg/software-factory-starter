import { describe, expect, it } from "vitest";
import {
  ChangePasswordSchema,
  DisableMfaSchema,
  otpauthUri,
  PRODUCT_NAME,
  ReauthSchema,
} from "./account.ts";

describe("本人のアカウントの取り決め", () => {
  it("認証アプリに読ませる URI は、発行者・メール・鍵を持ち、記号は符号にする", () => {
    expect(otpauthUri("a+b@acme.test", "ABC234", "My App")).toBe(
      "otpauth://totp/My%20App%3Aa%2Bb%40acme.test?secret=ABC234&issuer=My%20App&algorithm=SHA1&digits=6&period=30",
    );
    expect(otpauthUri("x@y.test", "S")).toContain(`issuer=${PRODUCT_NAME}`);
  });

  it("コードは数字6桁だけ。パスワードの入れ直しでコードは任意・外すときは必須", () => {
    expect(ReauthSchema.safeParse({ password: "p" }).success).toBe(true);
    expect(ReauthSchema.safeParse({ password: "p", code: "12345" }).success).toBe(false);
    expect(DisableMfaSchema.safeParse({ password: "p" }).success).toBe(false);
    expect(
      ChangePasswordSchema.safeParse({ currentPassword: "a", newPassword: "b", code: "123456" })
        .success,
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { parseTenantApplication } from "../../src/onboarding/create-tenant.ts";

// 申し込みの JSON(docs/specs/0026-tenant-provisioning.md)。申込書・事前登録の項目をそのまま渡せること。

const minimal = { name: "山田工務店", admin: { email: "Owner@Yamada.test", name: "山田 一郎" } };

describe("申し込みの JSON を読む", () => {
  it("時間帯と二段階認証は既定(Asia/Tokyo・必須にしない)。メールは小文字にそろえる", () => {
    const { application, ignoredKeys } = parseTenantApplication(JSON.stringify(minimal));
    expect(application).toMatchObject({
      name: "山田工務店",
      timeZone: "Asia/Tokyo",
      mfaRequired: false,
      admin: { email: "owner@yamada.test", name: "山田 一郎" },
    });
    expect(ignoredKeys).toEqual([]);
  });

  it("知らない項目(プラン・人数・始まりの日など)は読み飛ばし、名前だけ返す", () => {
    const { ignoredKeys } = parseTenantApplication(
      JSON.stringify({ ...minimal, plan: "standard", seats: 10, startDate: "2026-11-01" }),
    );
    expect(ignoredKeys).toEqual(["plan", "seats", "startDate"]);
  });

  it("違う項目の名前だけを言う(値は出さない)", () => {
    const bad = {
      ...minimal,
      timeZone: "Mars/Base",
      admin: { email: "secret-not-mail", name: "" },
    };
    const run = () => parseTenantApplication(JSON.stringify(bad));
    expect(run).toThrow(/timeZone/);
    expect(run).toThrow(/admin\.email/);
    expect(run).toThrow(/admin\.name/);
    expect(run).not.toThrow(/secret-not-mail/);
  });

  it("JSON でなければ止める", () => {
    expect(() => parseTenantApplication("name=山田")).toThrow(/JSON として読めません/);
  });
});

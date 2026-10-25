import { describe, expect, it } from "vitest";
import { withPreRegistration } from "../../src/onboarding/from-pre-registration.ts";

// 事前登録から組織を作るときの、申込書との合わせ方(docs/designs/0025-public-landing-page.md の 5)。

const pre = { organizationName: "サンプル商事(架空)", adminEmail: "owner@sample.test" };

describe("申込書に事前登録の名前とメールを入れる", () => {
  it("申込書に名前・メールが無ければ、事前登録の値で埋める(ほかの項目はそのまま)", () => {
    expect(
      withPreRegistration(
        { timeZone: "Asia/Tokyo", admin: { name: "管理 太郎" }, plan: "pro" },
        pre,
      ),
    ).toEqual({
      timeZone: "Asia/Tokyo",
      plan: "pro",
      name: pre.organizationName,
      admin: { name: "管理 太郎", email: pre.adminEmail },
    });
  });

  it("同じ値なら通る(前後の空白・メールの大文字小文字は違いとみなさない)", () => {
    const out = withPreRegistration(
      { name: ` ${pre.organizationName} `, admin: { name: "x", email: "Owner@Sample.TEST" } },
      pre,
    ) as { name: string; admin: { email: string } };
    expect(out.name).toBe(pre.organizationName);
    expect(out.admin.email).toBe(pre.adminEmail);
  });

  it("違う値は、項目の名前だけを言って止める(値は出さない)", () => {
    const run = () =>
      withPreRegistration({ name: "別の会社", admin: { name: "x", email: "other@x.test" } }, pre);
    expect(run).toThrow("name, admin.email");
    expect(run).not.toThrow("別の会社");
    expect(run).not.toThrow("other@x.test");
  });

  it("オブジェクトでない申込書・admin は止める", () => {
    expect(() => withPreRegistration([], pre)).toThrow("オブジェクトではない");
    expect(() => withPreRegistration(null, pre)).toThrow("オブジェクトではない");
    expect(() => withPreRegistration({ admin: "x" }, pre)).toThrow("(admin)");
  });
});

import { describe, expect, it } from "vitest";
import { supportReadAction } from "../../src/audit/actions.ts";
import { generateSupportCode, hashSupportCode } from "../../src/domains/organizations/support.ts";

describe("サポート番号", () => {
  it("4桁ずつ3つ・紛らわしい字(0 O 1 I L U)を使わない・毎回違う", () => {
    const codes = Array.from({ length: 200 }, generateSupportCode);
    for (const c of codes)
      expect(c).toMatch(/^[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$/);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("小文字・区切り・空白の揺れは同じ番号として扱う(保存するのはハッシュだけ)", () => {
    const h = hashSupportCode("K7QM-2XPA-9DNE");
    expect(hashSupportCode("k7qm 2xpa 9dne")).toBe(h);
    expect(hashSupportCode("K7QM2XPA9DNE")).toBe(h);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("K7QM");
  });
});

describe("代理の社員が読んだ記録の対象", () => {
  it("パスの最後の ID が対象になる。一覧は対象なし", () => {
    expect(supportReadAction("/api/projects/{projectId}/tasks")).toMatchObject({
      target: "project",
      param: "projectId",
    });
    expect(supportReadAction("/api/projects")).toMatchObject({ target: "none" });
  });
});

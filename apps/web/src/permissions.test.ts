import { describe, expect, it } from "vitest";
import { canDeleteProject, canWrite } from "./permissions.ts";

describe("画面のボタンの出し分け", () => {
  it("閲覧者には書き込みのボタンを出さない", () => {
    expect(canWrite("viewer")).toBe(false);
    expect(canWrite("member")).toBe(true);
  });

  it("プロジェクトを消せるのは管理者だけ", () => {
    expect(canDeleteProject("admin")).toBe(true);
    expect(canDeleteProject("member")).toBe(false);
  });
});

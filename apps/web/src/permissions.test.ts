import type { Me } from "@app/shared";
import { describe, expect, it } from "vitest";
import { canDeleteProject, canManageAccount, canWrite } from "./permissions.ts";

describe("画面のボタンの出し分け", () => {
  it("閲覧者には書き込みのボタンを出さない", () => {
    expect(canWrite("viewer")).toBe(false);
    expect(canWrite("member")).toBe(true);
  });

  it("自分のアカウントは、代理ログインの最中は変えられない", () => {
    const me = { role: "member" } as Me;
    expect(canManageAccount(me)).toBe(true);
    expect(canManageAccount({ ...me, support: { expiresAt: "2026-10-20T00:00:00Z" } })).toBe(false);
  });

  it("プロジェクトを消せるのは管理者だけ", () => {
    expect(canDeleteProject("admin")).toBe(true);
    expect(canDeleteProject("member")).toBe(false);
  });
});

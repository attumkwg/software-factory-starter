import { expect, test } from "@playwright/test";
import { expectAccessible, loginAs } from "./helpers.ts";

// 監査ログ(docs/specs/0003-audit-log.md)。管理者だけが見られ、書き込みが残る。

test("管理者は監査ログで、自分が作ったプロジェクトの記録を見られる", async ({ page }) => {
  await loginAs(page, "admin@acme.test");
  const name = `監査の確かめ ${Date.now()}`;
  const status = await page.evaluate(async (n) => {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: n }),
    });
    return res.status;
  }, name);
  expect(status).toBe(201);

  await page.getByRole("link", { name: "設定" }).click();
  await page.getByRole("link", { name: "監査ログを見る" }).click();
  await expect(page.getByRole("heading", { name: "監査ログ" })).toBeVisible();
  const table = page.getByRole("grid", { name: "監査ログ" });
  await expect(
    table.getByRole("row").filter({ hasText: "プロジェクトを作った" }).first(),
  ).toBeVisible();
  // 値(プロジェクトの名前)は記録に残らない
  await expect(page.getByText(name)).toHaveCount(0);
  await expectAccessible(page);
});

test("メンバーには設定(監査ログ)のリンクが出ず、開いても見られない", async ({ page }) => {
  await loginAs(page, "member@acme.test");
  await expect(page.getByRole("link", { name: "設定" })).toHaveCount(0);
  // 直接開くと受け皿が出て、応答は 403(サーバーの失敗の 500 にしない。#186)。行き止まりにしない
  for (const path of ["/audit", "/settings"]) {
    const res = await page.goto(path);
    expect(res?.status(), `${path} の応答`).toBe(403);
    await expect(page.getByText("この操作の権限がありません")).toBeVisible();
    await expect(page.getByRole("link", { name: "最初の画面へ" })).toHaveAttribute("href", "/");
  }
});

test("閲覧の人も、設定と監査ログを直接開くと 403 と受け皿(#186)", async ({ page }) => {
  await loginAs(page, "viewer@acme.test");
  for (const path of ["/audit", "/settings"]) {
    const res = await page.goto(path);
    expect(res?.status(), `${path} の応答`).toBe(403);
    await expect(page.getByText("この操作の権限がありません")).toBeVisible();
  }
});

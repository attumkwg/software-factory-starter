import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers.ts";

test("閲覧者には書き込みのボタンが出ず、API に直接送っても 403", async ({ page }) => {
  await loginAs(page, "viewer@acme.test");
  await expect(page.getByTestId("role")).toHaveAttribute("data-role", "viewer");
  await expect(page.getByRole("button", { name: "作る" })).toHaveCount(0);

  // 画面で隠すだけでなく、API でも止まっていること(守りは API 側)
  const status = await page.evaluate(async () => {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "閲覧者が作ろうとした" }),
    });
    return res.status;
  });
  expect(status).toBe(403);
});

import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers.ts";

// 種データの2社(Acme と Globex)が、画面の上でも混ざらないこと
test("他社のプロジェクトは一覧に出ず、ID を直接指定しても 404", async ({ page }) => {
  await loginAs(page, "admin@globex.test");
  const list = page.getByRole("list", { name: "プロジェクト一覧" });
  await expect(list).toContainText("Globex の秘密の計画");
  await expect(list).not.toContainText("Acme の立ち上げ");

  const acmeProjectId = "0199a000-0000-7000-8000-00000000a101";
  const status = await page.evaluate(
    async (id) => (await fetch(`/api/projects/${id}`)).status,
    acmeProjectId,
  );
  expect(status).toBe(404);
});

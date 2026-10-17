import { expect, test } from "@playwright/test";
import { expectAccessible, loginAs } from "./helpers.ts";

test("メンバーはプロジェクトを作り、タスクを足して完了にできる", async ({ page }) => {
  const projectName = `E2E の計画 ${Date.now()}`;
  await loginAs(page, "member@acme.test");

  await page.getByLabel("新しいプロジェクトの名前").fill(projectName);
  await page.getByRole("button", { name: "作る" }).click();
  await page.getByRole("button", { name: projectName }).click();

  await expect(page.getByRole("heading", { name: projectName })).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel("新しいタスク").fill("見積もりを出す");
  await page.getByRole("button", { name: "足す" }).click();

  const task = page.getByRole("checkbox", { name: "見積もりを出す" });
  // 人と同じく文字の部分を押す(本当のチェックの入力は見えないように重ねてある)。
  // 保存してから表示が変わるので、check() ではなく click して結果を待つ
  await page.getByText("見積もりを出す", { exact: true }).click();
  await expect(task).toBeChecked();

  // 読み直しても残っている(DB に保存されている)
  await page.reload();
  await page.getByRole("button", { name: projectName }).click();
  await expect(page.getByRole("checkbox", { name: "見積もりを出す" })).toBeChecked();
});

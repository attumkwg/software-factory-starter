import { expect, test } from "@playwright/test";
import { expectAccessible, loginAs } from "./helpers.ts";

// 利用規約・プライバシーポリシー(docs/specs/0008-legal-consent.md)。
// 種データの newcomer@acme.test は、まだ同意していない人(同意すると次からはふつうに使える)。
// 同意は消せないので、同意の流れは1回の起動で1度だけ通る(手元で流し直すときは docker compose down -v で DB を作り直す)。

test("本文はログインしなくても読め、版と変更の履歴が出る。公開前・無い版は見つからない", async ({
  page,
}) => {
  await page.goto("/legal/terms");
  await expect(page.getByRole("heading", { name: "利用規約", level: 1 })).toBeVisible();
  await expect(page.getByText("版 1(いまの版)", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "第1条(適用)" })).toBeVisible();
  await expect(page.getByRole("list", { name: "変更の履歴" })).toContainText("最初の版");
  await expectAccessible(page);

  await page.goto("/legal/privacy/1");
  await expect(page.getByRole("heading", { name: "プライバシーポリシー", level: 1 })).toBeVisible();
  // 公開前・無い版・無い文書は「見つかりません」
  const missing = await page.goto("/legal/terms/999");
  expect(missing?.status()).toBe(404);
  expect((await page.goto("/legal/cookies"))?.status()).toBe(404);
});

test("同意していない人は、どの画面を開いても同意の画面へ回され、同意すると元の画面へ戻る", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("メールアドレス").fill("newcomer@acme.test");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: "利用規約などへの同意" })).toBeVisible();
  await expect(page).toHaveURL(/\/legal\/accept/);
  await expect(page.getByRole("list", { name: "同意をお願いしている文書" })).toContainText(
    "利用規約(版 1",
  );
  await expect(page.getByText("同意しない場合は")).toBeVisible();
  await expect(page.getByRole("button", { name: "ログアウト" })).toBeVisible();
  await expectAccessible(page);

  // API も止まっている(画面で隠すだけでない)
  const status = await page.evaluate(async () => (await fetch("/api/projects")).status);
  expect(status).toBe(403);

  // チェックするまで押せない
  const agree = page.getByRole("button", { name: "同意する" });
  await expect(agree).toBeDisabled();
  await page.getByText("上の内容を確かめ、同意します").click();
  await agree.click();
  await expect(page.getByRole("heading", { name: "プロジェクト" })).toBeVisible();

  // 次からはふつうに使える
  await page.reload();
  await expect(page.getByRole("heading", { name: "プロジェクト" })).toBeVisible();
});

test("同意済みの人には同意の画面も帯も出ず、画面の下に規約へのリンクがある", async ({ page }) => {
  await loginAs(page, "member@acme.test");
  await expect(page.getByTestId("legal-notice")).toHaveCount(0);
  const footer = page.getByRole("navigation", { name: "規約" });
  await footer.getByRole("link", { name: "プライバシーポリシー" }).click();
  await expect(page.getByRole("heading", { name: "プライバシーポリシー", level: 1 })).toBeVisible();
});

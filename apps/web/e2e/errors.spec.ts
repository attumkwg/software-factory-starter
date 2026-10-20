import { expect, test } from "@playwright/test";
import { expectAccessible, loginAs } from "./helpers.ts";

// API が失敗したときに、画面が黙らないこと(何が起きて、次に何をすればよいかが出る)。
// ブラウザから API への通信を page.route で差し替えて、失敗を起こす。

const failure = (status: number, code: string) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify({ error: { code, message: "x", requestId: "e2e-req-1" } }),
});

test("作るのに失敗したら、入力を残したまま理由と問い合わせ番号を出す", async ({ page }) => {
  await loginAs(page, "member@acme.test");
  await page.route("**/api/projects", (route) =>
    route.request().method() === "POST"
      ? route.fulfill(failure(503, "service_unavailable"))
      : route.continue(),
  );

  await page.getByLabel("新しいプロジェクトの名前").fill("失敗する計画");
  await page.getByRole("button", { name: "作る" }).click();

  await expect(page.getByText(/混み合っているか、止まっています.*e2e-req-1/)).toBeVisible();
  await expect(page.getByLabel("新しいプロジェクトの名前")).toHaveValue("失敗する計画");
  await expect(page.getByRole("button", { name: "作る" })).toBeEnabled();
  await expectAccessible(page);

  // 直ったら、そのままもう一度押せば作れる(失敗の印が残ってブラウザに送信を止められない)
  await page.unroute("**/api/projects");
  await page.getByRole("button", { name: "作る" }).click();
  await expect(page.getByRole("link", { name: "失敗する計画" }).first()).toBeVisible();
});

test("書き込みのときにログインが切れていたら、ログイン画面へ", async ({ page }) => {
  await loginAs(page, "member@acme.test");
  // セッションの Cookie を消す(本当に切れた状態。API は 401 を返す)
  await page.context().clearCookies();

  await page.getByLabel("新しいプロジェクトの名前").fill("切れたあとに作る");
  await page.getByRole("button", { name: "作る" }).click();

  await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible();
});

test("画面を読むのに失敗したら、理由を出し「もう一度読み込む」で戻れる", async ({ page }) => {
  await loginAs(page, "member@acme.test");
  // 一覧 → プロジェクトの画面へ移動(ここからはブラウザが API を読む)
  await page.getByRole("link", { name: "Acme の立ち上げ" }).first().click();
  await expect(page.getByRole("heading", { name: "Acme の立ち上げ" })).toBeVisible();

  // 一覧は ?limit=…&cursor=… 付きで呼ぶので、道すじ(pathname)で当てる
  const projectsApi = (url: URL) => url.pathname === "/api/projects";
  await page.route(projectsApi, (route) => route.abort("connectionrefused"));
  await page.getByRole("link", { name: "← プロジェクト一覧" }).click();
  await expect(page.getByRole("heading", { name: "うまく表示できませんでした" })).toBeVisible();
  await expect(page.getByText("通信できませんでした")).toBeVisible();
  await expectAccessible(page);

  await page.unroute(projectsApi);
  await page.getByRole("button", { name: "もう一度読み込む" }).click();
  await expect(page.getByRole("heading", { name: "プロジェクト" })).toBeVisible();
});

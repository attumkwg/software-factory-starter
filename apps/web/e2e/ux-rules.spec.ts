// 使いやすさの決まりのうち、画面を開いて機械で見られる物(仕様 0100・G-163。見方は docs/guides/ux-review.md)。
// 主ボタン(variant="primary")は1画面に1つまで(手引きの 4・docs/design-system.md の Button)。
// 今ある外れは KNOWN に理由と穴の番号つきで並べる(ラチェット: 新しい外れは落ちる・直したら KNOWN から消さないと落ちる)。
import { expect, type Page, test } from "@playwright/test";
import { loginAs } from "./helpers";

/** 画面の名前 → 開き方 */
const SCREENS: { name: string; open: (page: Page) => Promise<void> }[] = [
  { name: "ログイン", open: (p) => p.goto("/login").then(() => undefined) },
  { name: "登録", open: (p) => p.goto("/sign-up").then(() => undefined) },
  { name: "パスワードの再設定", open: (p) => p.goto("/forgot-password").then(() => undefined) },
  { name: "プロジェクト", open: (p) => p.goto("/").then(() => undefined) },
  {
    name: "タスク",
    open: async (p) => {
      await p.goto("/");
      await p.getByRole("link", { name: "Acme の立ち上げ" }).click();
      await expect(p.getByRole("heading", { name: "Acme の立ち上げ" })).toBeVisible();
    },
  },
  { name: "設定", open: (p) => p.goto("/settings").then(() => undefined) },
  { name: "アカウント", open: (p) => p.goto("/account").then(() => undefined) },
  { name: "組織の人", open: (p) => p.goto("/members").then(() => undefined) },
  { name: "招待", open: (p) => p.goto("/invitations").then(() => undefined) },
  { name: "監査ログ", open: (p) => p.goto("/audit").then(() => undefined) },
  { name: "サポートへの許可", open: (p) => p.goto("/support-access").then(() => undefined) },
];

const LOGGED_OUT = new Set(["ログイン", "登録", "パスワードの再設定"]);

/** 直すのは G-164(部品の段)。直したら、ここから消す */
const KNOWN: Record<string, string> = {};

test("主ボタンは1画面に1つまで(管理者で主な画面を見て回る)", async ({ page }) => {
  const over: string[] = [];
  let withOne = 0;
  let loggedIn = false;
  for (const screen of SCREENS) {
    if (!LOGGED_OUT.has(screen.name) && !loggedIn) {
      await loginAs(page, "admin@acme.test");
      loggedIn = true;
    }
    await screen.open(page);
    await page.waitForLoadState("networkidle");
    const primary = page.locator(".ui-button--primary:visible");
    const count = await primary.count();
    if (count === 1) withOne += 1;
    if (count > 1) over.push(screen.name);
  }
  // 拾い方が壊れて0件で通るのを防ぐ(ログイン・プロジェクトの「作る」・タスクの「足す」などは1つある)
  expect(withOne).toBeGreaterThanOrEqual(3);
  expect(over.sort(), "主ボタンが2つ以上ある画面(1つにするか、KNOWN に理由を書く)").toEqual(
    Object.keys(KNOWN).sort(),
  );
});

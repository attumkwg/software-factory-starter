import { defineConfig, devices } from "@playwright/test";

// 叩く先は E2E_BASE_URL(既定は docker compose の http://localhost:8080 = ALB の代わり)。
// PR のプレビュー環境では preview.yml が https://pr-<番号>.preview.<domain> を渡す。
// E2E_AUTH=cognito … 偽物の Cognito でのログインだけを流す(docker-compose.cognito.yml を重ねて立てたとき)。
// それ以外(既定)… 開発用ログインで、ふだんの流れを全部流す
const cognito = process.env.E2E_AUTH === "cognito";

// スマホの組。幅は WCAG の reflow(1.4.10)の 320px(いちばん狭いスマホ。ここで横にはみ出さなければ広い端末も大丈夫)。
// CI に入れてあるのは Chromium だけなので、Chromium の端末(Pixel 7)の設定に幅だけ重ねる(iPhone は WebKit が要る)。
// 時間を倍にしないよう、主な流れ(ログイン → プロジェクト → タスク・列の多い表・無い画面)と、
// それ以外の表・入力の画面を見るだけで回る narrow-screens だけを流す。
// 決めた理由は docs/designs/0008-web-noindex-mobile.md・docs/designs/0010-web-head-ogp.md
const MOBILE_SPECS = [
  "task-flow.spec.ts",
  "audit.spec.ts",
  "not-found.spec.ts",
  "narrow-screens.spec.ts",
  "design-system.spec.ts",
];

export default defineConfig({
  testDir: "./e2e",
  // 見た目の回帰テスト(e2e/vrt)は別の設定(playwright.vrt.config.ts・pnpm vrt)。ブラウザを Docker の中で動かす
  ...(cognito
    ? { testMatch: "cognito-*.spec.ts" }
    : { testIgnore: ["cognito-*.spec.ts", "vrt/**"] }),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    // PR に貼る証拠(スクショ・動画・トレース)
    screenshot: "on",
    video: "retain-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    ...(cognito
      ? []
      : [
          {
            name: "mobile",
            use: { ...devices["Pixel 7"], viewport: { width: 320, height: 720 } },
            testMatch: MOBILE_SPECS,
          },
        ]),
  ],
});

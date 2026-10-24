import { defineConfig, devices } from "@playwright/test";

// 見た目の回帰テスト(VRT)。主な画面を撮り、e2e/vrt/__screenshots__ の基準の画像と比べる。
//   pnpm vrt          比べる(違えば落ちる。基準・今回・差分は test-results-vrt/)
//   pnpm vrt:update   基準を撮り直す(画面を変えたとき。撮り直した画像をコミットする)
// 先に、アプリ(docker compose up --build -d)と、ブラウザ(docker compose -f docker-compose.vrt.yml up -d --wait)を立てる。
//
// ブラウザは Docker の中(Playwright の公式イメージ。版を固定)で動かし、テストの本体だけが手元・CI の Node で動く。
// どの OS から流しても、描くのは同じ Chromium と同じフォントなので、同じ画像になる(ADR 0024)。
// ブラウザが開く localhost:8080 は、exposeNetwork でテストの本体の localhost:8080 に通る(ふつうの E2E と同じ URL)。
// 決めた理由は docs/designs/0011-visual-regression.md
export default defineConfig({
  testDir: "./e2e/vrt",
  // 同じ所にある単体テスト(*.test.ts。vitest が流す)を拾わない
  testMatch: "*.spec.ts",
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  outputDir: "test-results-vrt",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // 揺れを再試行で隠さない(揺れたら差分を見て、揺れる所を塗る)
  retries: 0,
  // 基準の無い画面は落とす。基準を作る・変えるのは pnpm vrt:update(--update-snapshots)だけ
  updateSnapshots: "none",
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report-vrt" }]]
    : "list",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      // スマホも CSS の 1 倍の画素で保存する(画像を小さく・人が見やすく)
      scale: "css",
      // 同じイメージで撮るので、違いは本当に違う。揺れる画面が出たら、その画面だけ許す画素を足す
      maxDiffPixels: 0,
    },
  },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    connectOptions: {
      wsEndpoint: process.env.VRT_WS_ENDPOINT ?? "ws://127.0.0.1:3100/",
      exposeNetwork: "<loopback>",
    },
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    screenshot: "off",
    video: "off",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // いまのスマホでいちばん多い幅(390px)。いちばん狭い 320px のはみ出しは、ふつうの E2E が見る
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
  ],
});

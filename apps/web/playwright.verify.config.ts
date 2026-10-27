import { defineConfig, devices } from "@playwright/test";

// PR の動作確認(/verify-pr)。e2e/verify/ に AI が書いた確認の手順(コミットしない)を流す。
//   pnpm --filter @app/web verify                     全部
//   pnpm --filter @app/web verify e2e/verify/pr-12.spec.ts   1本
// 叩く先は E2E_BASE_URL(PR のプレビュー環境か、既定の docker compose の http://localhost:8080)。
// 結果は「通った」だけでは合格にしない。verify-fixture.ts が集めた記録(画面のエラー・失敗した通信・API の直叩き)と
// トレースを AI が疑って読む(2層目)。1層目は pnpm verify:lint。決めた理由は docs/designs/0076-verify-pr.md
export default defineConfig({
  testDir: "./e2e/verify",
  testMatch: "*.spec.ts",
  outputDir: "test-results-verify",
  // 1本ずつ順に流す(手順の記録を読みやすく。データを書き込む確認どうしがぶつからない)
  workers: 1,
  // 揺れを再試行で隠さない(揺れたら「非同期の偽陽性」を疑う)
  retries: 0,
  forbidOnly: true,
  reporter: [["list"], ["json", { outputFile: "test-results-verify/report.json" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    ...devices["Desktop Chrome"],
    // 疑って読むための証拠(PR に貼るのはスクショと手順。トレースは手元で開く)
    screenshot: "on",
    trace: "on",
  },
});

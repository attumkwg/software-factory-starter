import { defineConfig, devices } from "@playwright/test";

// 叩く先は E2E_BASE_URL(既定は docker compose の http://localhost:8080 = ALB の代わり)。
// PR のプレビュー環境では preview.yml が https://pr-<番号>.preview.<domain> を渡す。
// E2E_AUTH=cognito … 偽物の Cognito でのログインだけを流す(docker-compose.cognito.yml を重ねて立てたとき)。
// それ以外(既定)… 開発用ログインで、ふだんの流れを全部流す
const cognito = process.env.E2E_AUTH === "cognito";

export default defineConfig({
  testDir: "./e2e",
  ...(cognito ? { testMatch: "cognito-*.spec.ts" } : { testIgnore: "cognito-*.spec.ts" }),
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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

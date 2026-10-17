import { defineConfig, devices } from "@playwright/test";

// 叩く先は E2E_BASE_URL(既定は docker compose の http://localhost:3000)。
// PR のプレビュー環境では preview.yml が https://pr-<番号>.preview.<domain> を渡す。
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    // PR に貼る証拠(スクショ・動画・トレース)
    screenshot: "on",
    video: "retain-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

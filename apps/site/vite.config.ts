import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { siteConfigFrom } from "./src/config.ts";

// 公開のページ(docs/specs/0025-public-landing-page.md)。静的な HTML を作り(scripts/prerender.mjs)、S3+CloudFront で配る。
// 設定はビルドのときの環境変数(SITE_ENV・SITE_URL・APP_URL)から。.env は読まない。
const config = siteConfigFrom(process.env);

export default defineConfig({
  plugins: [viteReact()],
  envDir: false,
  define: { __SITE_CONFIG__: JSON.stringify(config) },
  server: { port: 5190 },
  preview: { port: 5190 },
  test: {
    environment: "node",
    // `pnpm test:coverage`(CI)でだけ測る。CI の単体は test:coverage を流すので、これが無いと LP のテストが1本も流れない。
    // 下限は 2026-10-31 の値(行 60.4%・分岐 42.7%)の少し下。下回ったら CI が落ちる。docs/guides/ci-limits.md
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["**/*.test.ts", "**/*.test.tsx"],
      reporter: ["text-summary"],
      thresholds: { lines: 58, branches: 40 },
    },
  },
});

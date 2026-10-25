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
  test: { environment: "node" },
});

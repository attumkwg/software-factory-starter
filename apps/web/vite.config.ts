import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// TanStack Start(SSR)。手元の開発では Vite(5173)が画面を描き、/api は API(3000)へ中継する。
// 本番は ALB が /api/* を API のサービスへ、それ以外をこの画面のサービスへ振り分ける(同じオリジン)。
export default defineConfig(({ command }) => ({
  plugins: [tanstackStart(), viteReact()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000" },
  },
  // 本番の SSR は依存も全部まとめる(イメージに node_modules を入れない。scripts/build-server.mjs)
  ssr: command === "build" ? { noExternal: true } : {},
  test: {
    // e2e/vrt の単体テスト(コメントの本文・版のそろい)も。Playwright の VRT は *.spec.ts だけを流す
    include: ["src/**/*.test.ts", "server/**/*.test.ts", "e2e/vrt/*.test.ts"],
    // `pnpm test:coverage`(CI)でだけ測る。画面(.tsx)は E2E で確かめるので、単体の値は低い。
    // 下限は 2026-10-20 の値(行 25.7%・分岐 25.4%)の少し下。下回ったら CI が落ちる。docs/guides/ci-limits.md
    coverage: {
      provider: "v8",
      include: ["src/**", "server/**"],
      exclude: ["**/*.test.ts", "src/routeTree.gen.ts"],
      reporter: ["text-summary"],
      thresholds: { lines: 23, branches: 23 },
    },
  },
}));

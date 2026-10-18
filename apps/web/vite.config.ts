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
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
  },
}));

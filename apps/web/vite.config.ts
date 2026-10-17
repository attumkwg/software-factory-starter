import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// 手元では Vite(5173)から API(3000)へ /api を中継する。本番は API が同じオリジンで画面も配る。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000" },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});

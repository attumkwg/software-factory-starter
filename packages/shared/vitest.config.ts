import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `pnpm test:coverage`(CI)でだけ測る。下限は 2026-10-20 の値(行 81.9%・分岐 63.2%)の少し下。
    // 下回ったら CI が落ちる。根拠と上げ方は docs/guides/ci-limits.md
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["**/*.test.ts"],
      reporter: ["text-summary"],
      thresholds: { lines: 79, branches: 61 },
    },
  },
});

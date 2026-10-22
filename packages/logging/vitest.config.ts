import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `pnpm test:coverage`(CI)でだけ測る。下限は作ったとき(2026-10-22。行 96.8%・分岐 78.7%)の値の少し下。docs/guides/ci-limits.md
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["**/*.test.ts"],
      reporter: ["text-summary"],
      thresholds: { lines: 94, branches: 76 },
    },
  },
});

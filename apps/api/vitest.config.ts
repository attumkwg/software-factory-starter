import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `pnpm test:coverage`(CI の結合のジョブ)でだけ測る。単体と結合を一緒に流した値(Docker が要る)。
    // 下限は 2026-10-22 の値(行 87.0%・分岐 79.7%)の少し下。下回ったら CI が落ちる。docs/guides/ci-limits.md
    coverage: {
      provider: "v8",
      include: ["src/**"],
      reporter: ["text-summary"],
      thresholds: { lines: 85, branches: 77 },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["test/unit/**/*.test.ts"],
        },
      },
      {
        // 本物の Postgres(Testcontainers)を立てる。Docker が要る。
        extends: true,
        test: {
          name: "integration",
          include: ["test/integration/**/*.int.test.ts"],
          globalSetup: ["test/integration/global-setup.ts"],
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});

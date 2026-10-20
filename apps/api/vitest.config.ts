import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `pnpm test:coverage`(CI)でだけ測る。単体(unit)だけの値で、結合(integration)の分は入っていない。
    // 下限は 2026-10-20 の値(行 35.5%・分岐 32.0%)の少し下。下回ったら CI が落ちる。docs/guides/ci-limits.md
    coverage: {
      provider: "v8",
      include: ["src/**"],
      reporter: ["text-summary"],
      thresholds: { lines: 33, branches: 30 },
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

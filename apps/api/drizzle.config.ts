import { defineConfig } from "drizzle-kit";

// 移行ファイルを作るだけなら DB は要らない(pnpm db:generate)。
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  casing: "snake_case",
  strict: true,
  verbose: true,
});

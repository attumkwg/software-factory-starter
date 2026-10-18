import { createApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config.ts";
import type { RootDb } from "../../src/db/client.ts";
import { createLogger } from "../../src/logger.ts";

/** DB 無しでアプリを組み立てて OpenAPI を取り出す(定義を作るだけなら DB は触らない)。 */
export function buildOpenApiDocument(mode: "dev" | "cognito") {
  const config = loadConfig({
    APP_ENV: mode === "dev" ? "test" : "stg",
    DATABASE_URL: "postgres://unused",
    SESSION_SECRET: "x".repeat(32),
    AUTH_MODE: mode,
    COGNITO_REGION: "ap-northeast-1",
    COGNITO_USER_POOL_ID: "ap-northeast-1_example",
    COGNITO_CLIENT_ID: "example",
    APP_URL: "https://app.stg.example.com",
    MAIL_SMTP_URL: "smtp://mail:25",
  });
  const app = createApp({
    config,
    db: {} as RootDb,
    logger: createLogger({ level: "silent" }),
  });
  return app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: { title: "software-factory-starter API", version: "0.1.0" },
  });
}

/** OpenAPI の全操作を「メソッド パス」の形で並べる。 */
export function listOperations(mode: "dev" | "cognito"): string[] {
  const doc = buildOpenApiDocument(mode);
  const ops: string[] = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of ["get", "post", "put", "patch", "delete"] as const) {
      if (item?.[method]) ops.push(`${method.toUpperCase()} ${path}`);
    }
  }
  return ops.sort();
}

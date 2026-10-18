import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { pino } from "pino";
import ssr from "#ssr";
import { createWebApp } from "./app.ts";

// 画面のサービスの起動。`pnpm --filter @app/web build` で dist/index.js(1つの JS)になる。
//   PORT             … 待ち受け(既定 3001。API の 3000 と同じタスクでも重ならないように)
//   API_INTERNAL_URL … SSR から API を読む先(ECS では Service Connect の http://api:3000)
//   LOG_LEVEL / SHUTDOWN_TIMEOUT_MS … API と同じ

const port = Number(process.env.PORT ?? 3001);
const shutdownTimeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 25_000);

// API と同じ形の JSON ログ(Logs Insights で service と requestId で引ける)
const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "web" },
  messageKey: "message",
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label }) },
  redact: {
    paths: ["cookie", "*.cookie", "authorization", "*.authorization"],
    censor: "[REDACTED]",
  },
});

const lifecycle = { shuttingDown: false };
const app = createWebApp({
  ssr: (request) => ssr.fetch(request),
  clientDir: fileURLToPath(new URL("./client", import.meta.url)),
  logger,
  lifecycle,
});

const server = serve({ fetch: app.fetch, port }, (info) => {
  logger.info(
    { port: info.port, apiInternalUrl: process.env.API_INTERNAL_URL ?? "http://localhost:3000" },
    "画面のサーバーを起動しました",
  );
});

// SIGTERM で正しく止まる(API の src/index.ts と同じ手順。こちらは DB を持たない)
let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  lifecycle.shuttingDown = true;
  logger.info({ signal }, "止めています");
  const force = setTimeout(() => {
    logger.error({ timeoutMs: shutdownTimeoutMs }, "時間内に止まらないので打ち切ります");
    process.exit(1);
  }, shutdownTimeoutMs);
  force.unref();
  server.close(() => {
    clearTimeout(force);
    logger.info("止まりました");
  });
  if ("closeIdleConnections" in server) server.closeIdleConnections();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

import { fileURLToPath } from "node:url";
import { createErrorReporter, logsLinkFrom } from "@app/error-reporting";
import { serve } from "@hono/node-server";
import ssr from "#ssr";
import { setReportError } from "../src/report-hook.ts";
import { createWebApp } from "./app.ts";
import { createWebLogger } from "./logger.ts";

// 画面のサービスの起動。`pnpm --filter @app/web build` で dist/index.js(1つの JS)になる。
//   PORT             … 待ち受け(既定 3001。API の 3000 と同じタスクでも重ならないように)
//   API_INTERNAL_URL … SSR から API を読む先(ECS では Service Connect の http://api:3000)
//   LOG_LEVEL / SHUTDOWN_TIMEOUT_MS … API と同じ
//   SENTRY_DSN / SENTRY_RELEASE / APP_ENV … 失敗を Sentry に送る(無ければ送らない)。ブラウザにも同じ DSN を渡す
//   LOGS_INSIGHTS_REGION / LOGS_INSIGHTS_GROUPS … Sentry の1件にログを開くリンクを付ける

const port = Number(process.env.PORT ?? 3001);
const shutdownTimeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 25_000);

const logLevel = process.env.LOG_LEVEL ?? "info";

// error 以上のログを Sentry にも送る(API と同じ。docs/guides/monitoring.md)
const reporter = createErrorReporter({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.APP_ENV ?? "local",
  service: "web",
  release: process.env.SENTRY_RELEASE,
  logsLink: logsLinkFrom(process.env.LOGS_INSIGHTS_REGION, process.env.LOGS_INSIGHTS_GROUPS),
});
// SSR の中(src/start.ts)の失敗も、同じ入口から送る
setReportError(reporter?.report);

// API と同じ部品・同じ形の JSON ログ(許可リストの項目だけ。server/logger.ts)
const logger = createWebLogger({ level: logLevel, reporter });

const lifecycle = { shuttingDown: false };
const app = createWebApp({
  ssr: (request) => ssr.fetch(request),
  clientDir: fileURLToPath(new URL("./client", import.meta.url)),
  logger,
  lifecycle,
  // 本番(prod)以外は全部、検索に載せない(server/app.ts)
  appEnv: process.env.APP_ENV,
  // ブラウザから失敗を送る先(CSP の connect-src に足す)
  sentryDsn: process.env.SENTRY_DSN,
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
  server.close(async () => {
    await reporter?.flush(2_000);
    clearTimeout(force);
    logger.info("止まりました");
  });
  if ("closeIdleConnections" in server) server.closeIdleConnections();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// どこにも受け止められなかった失敗。JSON で1行残して止まる(ECS が新しいタスクを立てる)。API と同じ決まり
// Sentry に送り終わるのを2秒まで待つ
async function die(err: unknown, message: string) {
  logger.fatal({ err }, message);
  await reporter?.flush(2_000);
  process.exit(1);
}
process.on("uncaughtException", (err) => void die(err, "受け止められなかった失敗で止まります"));
process.on(
  "unhandledRejection",
  (err) => void die(err, "受け止められなかった Promise の失敗で止まります"),
);

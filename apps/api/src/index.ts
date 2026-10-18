import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createDb } from "./db/client.ts";
import { createLogger } from "./logger.ts";
import { runOutsideRequestContext } from "./request-context.ts";

const config = loadConfig();
const logger = createLogger({ level: config.logLevel });
const { db, pool } = createDb(config.databaseUrl, {
  // 接続を作ったリクエストの文脈が残っているので、外して記録する
  onIdleError: (err) =>
    runOutsideRequestContext(() =>
      logger.warn({ err }, "使っていない DB の接続が切れました(DB の再起動など)"),
    ),
});
const lifecycle = { shuttingDown: false };
const app = createApp({ config, db, logger, lifecycle });

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info(
    { port: info.port, appEnv: config.appEnv, authMode: config.auth.mode },
    "API を起動しました",
  );
});

/**
 * SIGTERM(ECS がタスクを止めるとき)で正しく止まる:
 * 1. /readyz を 503 にして、ALB に「もう送らないで」と伝える
 * 2. 新しい接続を受けず、処理中のリクエストが終わるのを待つ
 * 3. DB の接続を閉じて終わる
 * 待ちすぎたら SHUTDOWN_TIMEOUT_MS で打ち切る(ECS の stopTimeout より短く)。
 */
let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  lifecycle.shuttingDown = true;
  logger.info({ signal }, "止めています");

  const force = setTimeout(() => {
    logger.error({ timeoutMs: config.shutdownTimeoutMs }, "時間内に止まらないので打ち切ります");
    process.exit(1);
  }, config.shutdownTimeoutMs);
  force.unref();

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    if ("closeIdleConnections" in server) server.closeIdleConnections();
  });
  await pool.end();
  clearTimeout(force);
  logger.info("止まりました");
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// どこにも受け止められなかった失敗。状態が壊れているかもしれないので、JSON で1行残して止まる
// (ECS が新しいタスクを立てる)。止まる前のログが Logs Insights で引けるように。
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "受け止められなかった失敗で止まります");
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  logger.fatal({ err }, "受け止められなかった Promise の失敗で止まります");
  process.exit(1);
});

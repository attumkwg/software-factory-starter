import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createDb } from "./db/client.ts";
import { createLogger } from "./logger.ts";

const config = loadConfig();
const logger = createLogger({ level: config.logLevel });
const { db, pool } = createDb(config.databaseUrl);
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

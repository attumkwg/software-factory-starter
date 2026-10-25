import { createErrorReporter } from "@app/error-reporting";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createDb, dbLogging } from "./db/client.ts";
import { linkKey } from "./domains/growth/index.ts";
import { createLogger } from "./logger.ts";
import { createMailer } from "./mail/index.ts";
import { outboxHandlers, startOutboxRelay } from "./outbox/index.ts";
import { sensitiveStoreFromConfig } from "./sensitive/index.ts";

const config = loadConfig();
// error 以上のログを Sentry にも送る(SENTRY_DSN が無ければ null。docs/guides/monitoring.md)
const reporter = createErrorReporter({
  dsn: config.sentry.dsn,
  environment: config.appEnv,
  service: "api",
  release: config.sentry.release,
  logsLink: config.sentry.logsLink,
});
const logger = createLogger({ level: config.logLevel, reporter });
// 接続が切れた・時間のかかったクエリをログに(db/client.ts の dbLogging)
const { db, pool } = createDb(config.databaseUrl, dbLogging(logger));
// 要配慮個人情報の接続(別のロール。ADR 0029)。設定が無ければ null
const sensitive = sensitiveStoreFromConfig(config.sensitive, dbLogging(logger));
const lifecycle = { shuttingDown: false };
const app = createApp({ config, db, logger, lifecycle, sensitive });

// 送信待ち(アウトボックス)の送り出し。止めるときは、DB を閉じる前に止める
const mailer = createMailer(config.mail, logger);
const relay = config.outboxRelay
  ? startOutboxRelay({
      db,
      logger,
      handlers: outboxHandlers({
        db,
        logger,
        mailer,
        appUrl: config.appUrl,
        publicSite: config.publicSite
          ? {
              url: config.publicSite.url,
              key: linkKey(config.session.secret),
              privacyUrl: `${config.appUrl}/legal/privacy`,
            }
          : null,
      }),
    })
  : null;

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
  await relay?.stop();
  await pool.end();
  await sensitive?.close();
  await reporter?.flush(2_000);
  clearTimeout(force);
  logger.info("止まりました");
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// どこにも受け止められなかった失敗。状態が壊れているかもしれないので、JSON で1行残して止まる
// (ECS が新しいタスクを立てる)。止まる前のログが Logs Insights で引けるように。
// Sentry に送り終わるのを2秒まで待つ(待っても届かなければ、ログにだけ残る)。
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

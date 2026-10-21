import type { Writable } from "node:stream";
import { createLogger, type Logger } from "@app/logging";
import type { DestinationStream } from "pino";

/**
 * 画面のサーバーのログ。API と同じ部品(@app/logging)・同じ形の JSON(Logs Insights で service と requestId で引ける)。
 * 出すのは許可リストの項目だけ。SSR の失敗(`{ err }`)も、値を伏せた形になる。
 */
export function createWebLogger(opts: {
  level: string;
  destination?: DestinationStream;
  /** error 以上の行を Sentry にも送る(SENTRY_DSN が無ければ null) */
  reporter?: { stream: Writable } | null;
}): Logger {
  return createLogger({ service: "web", ...opts });
}

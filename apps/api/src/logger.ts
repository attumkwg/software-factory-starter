import type { ErrorReporter } from "@app/error-reporting";
import { createLogger as createAppLogger, type Logger } from "@app/logging";
import type { DestinationStream } from "pino";
import { serializeError } from "./errors.ts";
import { getRequestContext } from "./request-context.ts";

export type { Logger };

/**
 * 標準出力に JSON を1行ずつ。全行に requestId / tenantId / userId / traceId が入る。
 * 出すのは許可リストの項目だけ(@app/logging。画面のサーバーと同じ部品)。知らない項目は [REDACTED]、
 * 分類表で個人情報の名前(name・email・title など)は深さを問わず伏せる。
 * 失敗は `{ err }` で渡す。SQL のパラメータや DB の detail(値が入る)は serializeError が落とし、文の値も伏せる。
 */
export function createLogger(opts: {
  level: string;
  destination?: DestinationStream;
  /** error 以上の行を Sentry にも送る(@app/error-reporting。SENTRY_DSN が無ければ null) */
  reporter?: ErrorReporter | null;
}): Logger {
  return createAppLogger({
    service: "api",
    level: opts.level,
    ...(opts.destination ? { destination: opts.destination } : {}),
    reporter: opts.reporter ?? null,
    serializeErr: serializeError,
    mixin() {
      const ctx = getRequestContext();
      return {
        requestId: ctx?.requestId ?? null,
        tenantId: ctx?.tenantId ?? null,
        userId: ctx?.userId ?? null,
        traceId: ctx?.traceId ?? null,
      };
    },
  });
}

import type { ErrorReporter } from "@app/error-reporting";
import { type DestinationStream, type Level, type Logger, pino } from "pino";
import { serializeError } from "./errors.ts";
import { getRequestContext } from "./request-context.ts";

export type { Logger };

/**
 * 標準出力に JSON を1行ずつ。全行に requestId / tenantId / traceId が入る。
 * 個人情報と秘密は redact で伏せる(ログにオブジェクトを丸ごと渡すのは Semgrep で止めている)。
 * 失敗は `{ err }` で渡す。SQL のパラメータや DB の detail(値が入る)は serializeError が落とす。
 */
export function createLogger(opts: {
  level: string;
  destination?: DestinationStream;
  /** error 以上の行を Sentry にも送る(@app/error-reporting。SENTRY_DSN が無ければ null) */
  reporter?: ErrorReporter | null;
}): Logger {
  const destination = opts.reporter
    ? pino.multistream([
        { level: opts.level as Level, stream: opts.destination ?? pino.destination(1) },
        { level: "error", stream: opts.reporter.stream },
      ])
    : opts.destination;
  return pino(
    {
      level: opts.level,
      base: { service: "api" },
      messageKey: "message",
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      serializers: { err: (err: unknown) => serializeError(err) },
      redact: {
        paths: [
          "password",
          "*.password",
          "token",
          "*.token",
          "idToken",
          "*.idToken",
          "email",
          "*.email",
          "authorization",
          "*.authorization",
          "cookie",
          "*.cookie",
        ],
        censor: "[REDACTED]",
      },
      mixin() {
        const ctx = getRequestContext();
        return {
          requestId: ctx?.requestId ?? null,
          tenantId: ctx?.tenantId ?? null,
          traceId: ctx?.traceId ?? null,
        };
      },
    },
    destination,
  );
}

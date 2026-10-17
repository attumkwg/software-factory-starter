import { type DestinationStream, type Logger, pino } from "pino";
import { getRequestContext } from "./request-context.ts";

export type { Logger };

/**
 * 標準出力に JSON を1行ずつ。全行に requestId / tenantId / traceId が入る。
 * 個人情報と秘密は redact で伏せる(ログにオブジェクトを丸ごと渡すのは Semgrep で止めている)。
 */
export function createLogger(opts: { level: string; destination?: DestinationStream }): Logger {
  return pino(
    {
      level: opts.level,
      base: { service: "api" },
      messageKey: "message",
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
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
    opts.destination,
  );
}

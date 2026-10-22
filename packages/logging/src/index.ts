import type { Writable } from "node:stream";
import { type DestinationStream, type Level, type LogFn, type Logger, pino } from "pino";
import { sanitizeFields } from "./fields.ts";
import { scrubText } from "./scrub-text.ts";
import { serializeError } from "./serialize-error.ts";

export {
  ALLOWED_KEYS,
  ALWAYS_REDACTED,
  isAllowedKey,
  isDeniedKey,
  REDACTED,
  sanitizeFields,
  scrubPath,
} from "./fields.ts";
export { scrubErrorText, scrubText } from "./scrub-text.ts";
export { type SerializeErrorOptions, serializeError } from "./serialize-error.ts";
export type { Logger };

/**
 * API と画面のサーバーのログ(標準出力に JSON を1行ずつ → CloudWatch)。
 *   - 項目は許可リストで絞る(fields.ts)。知らない名前は [REDACTED]
 *   - 失敗は `{ err }` で渡す。serializeErr(既定は serializeError)で、値を伏せた形にする
 *   - ログの文(message)も伏せ字を通す(テンプレート文字列に値を入れても、メールアドレスや数字の並びは出ない)
 */
export function createLogger(opts: {
  service: string;
  level: string;
  destination?: DestinationStream;
  /** error 以上の行を Sentry にも送る(@app/error-reporting。SENTRY_DSN が無ければ null) */
  reporter?: { stream: Writable } | null;
  /** 全行に足す項目(requestId など。これも許可リストを通る) */
  mixin?: () => Record<string, unknown>;
  serializeErr?: (err: unknown) => Record<string, unknown>;
}): Logger {
  const serializeErr = opts.serializeErr ?? ((err: unknown) => serializeError(err));
  const destination = opts.reporter
    ? pino.multistream([
        { level: opts.level as Level, stream: opts.destination ?? pino.destination(1) },
        { level: "error", stream: opts.reporter.stream },
      ])
    : opts.destination;
  return pino(
    {
      level: opts.level,
      base: { service: opts.service },
      messageKey: "message",
      timestamp: pino.stdTimeFunctions.isoTime,
      ...(opts.mixin ? { mixin: opts.mixin } : {}),
      formatters: {
        level: (label) => ({ level: label }),
        // mixin を混ぜた後・書き出す前の1行。ここで絞る(pino の既定の err の形は使わない)
        log: (obj) => {
          const { err, ...rest } = obj;
          const out = sanitizeFields(rest);
          if (err !== undefined) out.err = serializeErr(err);
          return out;
        },
      },
      serializers: { err: (err: unknown) => err },
      hooks: {
        logMethod(args, method) {
          const scrubbed = args.map((a) => (typeof a === "string" ? scrubText(a, 1000) : a));
          method.apply(this, scrubbed as Parameters<LogFn>);
        },
      },
    },
    destination,
  );
}

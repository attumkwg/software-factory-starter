import { serializeError as serializeLogError } from "@app/logging";
import type { ErrorCode } from "@app/shared";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** API が返す失敗。本文は { error: { code, message, requestId } } の形にそろえる。code は packages/shared の ERROR_CODES。 */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message = "入力が正しくありません") =>
  new ApiError(400, "bad_request", message);
export const unauthorized = () => new ApiError(401, "unauthorized", "ログインが必要です");
export const forbidden = () => new ApiError(403, "forbidden", "この操作の権限がありません");
// 他社の物は「無い」と答える(存在すること自体を漏らさない)
export const notFound = () => new ApiError(404, "not_found", "見つかりません");
export const conflict = () =>
  new ApiError(409, "conflict", "ほかの変更とぶつかりました。読み込み直してください");
export const payloadTooLarge = () => new ApiError(413, "payload_too_large", "本文が大きすぎます");
export const serviceUnavailable = () =>
  new ApiError(503, "service_unavailable", "一時的に使えません。少し待ってから試してください");
export const internal = () => new ApiError(500, "internal", "内部エラーです");

// ─────────────────────────────────────────────────────────────────────────────
// 想定外の失敗を、利用者に返す形に直す(app.ts の onError から)。
//
//   DB が一時的に使えない(再起動・切り替え・接続の上限・時間切れ)→ 503(少し待てば通る)
//   一意や外部キーの制約に当たった(同時に消された・同時に作った)   → 409(読み直せば通る)
//   それ以外                                                        → 500
//
// 中身(SQL・値・スタック)は返さない。ログに残すのは serializeError を通した形だけ。
// ─────────────────────────────────────────────────────────────────────────────

/** Postgres の SQLSTATE のうち、待てば通るもの。 */
const RETRYABLE_SQLSTATE = new Set([
  "25P03", // idle_in_transaction_session_timeout(トランザクションを開いたまま止まっていた。db/client.ts)
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "53300", // too_many_connections
  "55P03", // lock_not_available
  "57014", // query_canceled(statement_timeout)
  "57P01", // admin_shutdown(再起動・フェイルオーバー)
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
]);
/** 読み直せば通るもの。 */
const CONFLICT_SQLSTATE = new Set([
  "23503", // foreign_key_violation(親が同時に消された)
  "23505", // unique_violation
]);
/** DB に届かない(Node の通信の失敗)。 */
const NETWORK_ERRNO = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
]);

type WithCode = { code?: unknown; cause?: unknown; message?: unknown };

/** Drizzle が包んだ失敗(cause)までたどって、DB と通信の code を探す。 */
function findCode(err: unknown): string | undefined {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur && typeof cur === "object"; i++) {
    const { code, cause } = cur as WithCode;
    if (typeof code === "string") return code;
    cur = cause;
  }
  return undefined;
}

/**
 * pg が「接続が切れた・つながらない」を code なしで投げるとき。
 * not queryable … 使用中の接続を DB が切った後に、同じ接続でクエリを頼んだ(idle_in_transaction_session_timeout)
 */
function isConnectionLost(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur && typeof cur === "object"; i++) {
    const { message, cause } = cur as WithCode;
    if (
      typeof message === "string" &&
      /Connection terminated|connection timeout|timeout exceeded when trying to connect|not queryable/i.test(
        message,
      )
    ) {
      return true;
    }
    cur = cause;
  }
  return false;
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof HTTPException) {
    switch (err.status) {
      case 400:
        // 例: 本文の JSON が壊れている
        return new ApiError(400, "bad_request", "本文が正しい JSON ではありません");
      case 401:
        return unauthorized();
      case 403:
        // 例: CSRF(よそのサイトからのフォームの送信)
        return forbidden();
      case 413:
        return payloadTooLarge();
      case 415:
        return new ApiError(415, "unsupported_media_type", "本文は JSON で送ってください");
      default:
        return err.status >= 500
          ? internal()
          : new ApiError(400, "bad_request", "このリクエストは受け付けられません");
    }
  }
  const code = findCode(err);
  if (code && CONFLICT_SQLSTATE.has(code)) return conflict();
  if (code && (RETRYABLE_SQLSTATE.has(code) || code.startsWith("08") || NETWORK_ERRNO.has(code))) {
    return serviceUnavailable();
  }
  if (isConnectionLost(err)) return serviceUnavailable();
  return internal();
}

// ─────────────────────────────────────────────────────────────────────────────
// ログに残す形。**値(SQL のパラメータ・行の中身)を出さない**。
//   Drizzle の失敗は message に「params: 題名, メールアドレス…」を含み、スタックの1行目にも同じ文が入る。
//   Postgres の失敗は detail に「Key (email)=(a@example.com)」のような値を含む。
//   ほかのライブラリの失敗の文にも値が入る(SMTP の「550 <アドレス>」・pg の「invalid input syntax: "値"」)。
// 残すのは: 種類・message(値を伏せた物)・code・制約や表の名前・スタックの行(at ...)・原因(cause)。
// 形は画面のサーバーと同じ @app/logging の serializeError。ここでは DB の項目と SQL の形を足すだけ。
// ─────────────────────────────────────────────────────────────────────────────

const SAFE_DB_FIELDS = ["code", "severity", "table", "column", "constraint", "routine"] as const;

export function serializeError(err: unknown): Record<string, unknown> {
  return serializeLogError(err, {
    safeFields: SAFE_DB_FIELDS,
    // DrizzleQueryError: query(プレースホルダーの $1 だけで値は無い)を残し、params は捨てる
    messageOf: (e) => (typeof e.query === "string" ? `Failed query: ${e.query}` : e.message),
  });
}

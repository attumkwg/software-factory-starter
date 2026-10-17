import type { ContentfulStatusCode } from "hono/utils/http-status";

/** API が返す失敗。本文は { error: { code, message, requestId } } の形にそろえる。 */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const unauthorized = () => new ApiError(401, "unauthorized", "ログインが必要です");
export const forbidden = () => new ApiError(403, "forbidden", "この操作の権限がありません");
// 他社の物は「無い」と答える(存在すること自体を漏らさない)
export const notFound = () => new ApiError(404, "not_found", "見つかりません");

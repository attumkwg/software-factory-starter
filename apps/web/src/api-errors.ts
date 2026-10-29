import type { ApiError } from "@app/shared";

// API の呼び出しの失敗の形(api.ts が投げ、画面の受け皿 errors.ts が読み分ける)。api.ts からも同じ名前で出す。

/** API が失敗を返した(4xx / 5xx)。code で分岐する(packages/shared の ERROR_CODES)。 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError | null,
  ) {
    super(body?.error.message ?? `HTTP ${status}`);
  }
  get code() {
    return this.body?.error.code;
  }
  get requestId() {
    return this.body?.error.requestId;
  }
}

/**
 * API まで届かなかった(通信が切れている・時間切れ)。
 * side … どこで起きたか。browser なら利用者の通信の問題かもしれない。server(SSR)ならこちらの問題。
 */
export class NetworkError extends Error {
  constructor(
    readonly reason: "timeout" | "unreachable",
    readonly side: "server" | "browser",
    options?: { cause?: unknown },
  ) {
    super(
      reason === "timeout" ? "API の応答が時間内にありませんでした" : "API に届きませんでした",
      options,
    );
  }
}

import { HttpError, NetworkError } from "./api.ts";
import { ERROR_MESSAGES, OTHER_MESSAGES, withRequestId } from "./messages.ts";

// 失敗を「利用者が次に何をすればよいか」の文に直す。**文の中身は messages.ts**(ここは選ぶだけ)。
// API の message や err.message はそのまま出さない。分岐は API の code(packages/shared の ERROR_CODES)で。

export type Described = {
  message: string;
  /** 問い合わせのときに使う(API の requestId) */
  requestId?: string;
  /** 読み直せば直る(ほかの人が変えた・消した・権限が変わった)。画面のデータを読み直す */
  shouldReload: boolean;
};

const RELOAD_CODES = new Set(["forbidden", "not_found", "conflict"]);

export function describeError(e: unknown): Described {
  if (e instanceof NetworkError) {
    // 画面のサーバー(SSR)から API に届かないのは、利用者の通信ではなく、こちらの問題
    const message =
      e.side === "server"
        ? ERROR_MESSAGES.service_unavailable
        : e.reason === "timeout"
          ? OTHER_MESSAGES.timeout
          : OTHER_MESSAGES.offline;
    return { message, shouldReload: false };
  }
  if (!(e instanceof HttpError) || e.code === undefined) {
    return { message: OTHER_MESSAGES.unknown, shouldReload: false };
  }
  return {
    // 新しい API が、この画面の知らない code を返したときも文が出るように
    message: ERROR_MESSAGES[e.code] ?? OTHER_MESSAGES.unknown,
    requestId: e.requestId,
    shouldReload: RELOAD_CODES.has(e.code),
  };
}

/** トーストや画面に出す1つの文(問い合わせ番号つき)。 */
export function errorText(d: Described): string {
  return d.requestId ? withRequestId(d.message, d.requestId) : d.message;
}

import { HttpError, NetworkError } from "./api.ts";

// 失敗を「利用者が次に何をすればよいか」の文に直す。API の message(英語の検証の文など)はそのまま出さない。
// 分岐は API の code(packages/shared の ERROR_CODES)で。status や message の文字では分けない。

export type Described = {
  message: string;
  /** 問い合わせのときに使う(API の requestId) */
  requestId?: string;
  /** 読み直せば直る(ほかの人が変えた・消した)。画面のデータを読み直す */
  shouldReload: boolean;
};

export function describeError(e: unknown): Described {
  if (e instanceof NetworkError && e.side === "server") {
    // 画面のサーバーから API に届かない。利用者の通信ではなく、こちらの問題
    return {
      message: "いま混み合っているか、止まっています。少し待ってから、もう一度試してください",
      shouldReload: false,
    };
  }
  if (e instanceof NetworkError) {
    return {
      message:
        e.reason === "timeout"
          ? "時間内に応答がありませんでした。少し待ってから、もう一度試してください"
          : "通信できませんでした。ネットの状態を確かめて、もう一度試してください",
      shouldReload: false,
    };
  }
  if (!(e instanceof HttpError)) {
    return { message: "うまくいきませんでした。もう一度試してください", shouldReload: false };
  }
  const requestId = e.requestId;
  switch (e.code) {
    case "unauthorized":
      return { message: "ログインが切れました。もう一度ログインしてください", shouldReload: false };
    case "forbidden":
      return { message: "この操作の権限がありません", requestId, shouldReload: true };
    case "not_found":
      return {
        message: "見つかりませんでした。ほかの人が消したかもしれません",
        requestId,
        shouldReload: true,
      };
    case "conflict":
      return {
        message:
          "ほかの変更とぶつかりました。最新の内容を読み込み直したので、もう一度試してください",
        requestId,
        shouldReload: true,
      };
    case "bad_request":
      return { message: "入力を確かめてください", requestId, shouldReload: false };
    case "payload_too_large":
      return { message: "大きすぎます。短くしてください", requestId, shouldReload: false };
    case "service_unavailable":
      return {
        message: "いま混み合っているか、止まっています。少し待ってから、もう一度試してください",
        requestId,
        shouldReload: false,
      };
    default:
      // internal・ALB の 502 / 504(本文が無い)など
      return {
        message: "うまくいきませんでした。時間をおいて、もう一度試してください",
        requestId,
        shouldReload: false,
      };
  }
}

/** トーストや画面に出す1つの文(問い合わせ番号つき)。 */
export function errorText(d: Described): string {
  return d.requestId ? `${d.message}(問い合わせ番号: ${d.requestId})` : d.message;
}

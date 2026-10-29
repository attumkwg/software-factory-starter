// ログインまわりの API の小さな部品(api.ts が使う。単体テストで確かめる)。

// API が出し直したセッションの Cookie(使っている間は期限が延びる。ADR 0017)の名前。
// SSR の応答に写すのはこれだけ(ほかの Cookie は SSR の GET では作られない)。
const SESSION_COOKIES = ["__Host-sid=", "sid="];

/** API の応答の Set-Cookie のうち、セッションの物だけ(SSR が画面の応答に写す。api.ts) */
export function sessionSetCookies(res: Response): string[] {
  return res.headers
    .getSetCookie()
    .filter((cookie) => SESSION_COOKIES.some((name) => cookie.startsWith(name)));
}

/** 二段階認証のコードは、有効な人だけが送る(空なら本文に入れない。API はコードの形を確かめる) */
export function withCode<T extends object>(body: T, code?: string): T | (T & { code: string }) {
  return code ? { ...body, code } : body;
}

/** SSR の API の失敗の番号を積む内側のヘッダー(画面のサーバーが 500 を API の断りの番号に直す。server/api-status.ts。#186) */
export const API_STATUS_HEADER = "x-kit-ssr-api-status";

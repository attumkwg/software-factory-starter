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

/** 画面の受け皿に届いた API の断りの番号を、画面のサーバーへ渡す内側のヘッダー(src/ssr-status.ts が積み、server/api-status.ts が読んで外す。#186) */
export const API_STATUS_HEADER = "x-kit-ssr-api-status";

/** 受け皿の番号として写してよい API の断り(400 は URL の形が変・401 は入り直し・403 は権限・404 は無い物) */
export const REFUSAL_STATUSES: readonly number[] = [400, 401, 403, 404];

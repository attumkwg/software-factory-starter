import { createIsomorphicFn } from "@tanstack/react-start";
import { appendResponseHeader } from "@tanstack/react-start/server";
import { HttpError } from "./api-errors.ts";
import { API_STATUS_HEADER, REFUSAL_STATUSES } from "./api-parts.ts";

// 画面の受け皿(pages/ErrorPages.tsx)まで届いた失敗が API の断り(400・401・403・404)なら、その番号を
// 画面のサーバー(server/api-status.ts)に渡す。サーバーはそれを見て、500 でなくその番号で返す(Issue 186)。
// 失敗のたびに積まないのは、画面が自分で拾った失敗(ログイン前の api.me() の 401 など)で、
// 本物の 500 まで断りに見せないため(Web の 5xx はアラームとデプロイの自動の戻しに使う)。

/** API の断りか(受け皿の番号として写してよいか) */
export const isRefusal = (e: unknown): e is HttpError =>
  e instanceof HttpError && REFUSAL_STATUSES.includes(e.status);

/** サーバーで描くときだけ、受け皿に届いた断りの番号を積む(ブラウザでは何もしない) */
export const markRefusal = createIsomorphicFn()
  .server((status: number) => appendResponseHeader(API_STATUS_HEADER, String(status)))
  .client((_status: number) => {});

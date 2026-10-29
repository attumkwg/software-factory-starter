import { API_STATUS_HEADER, REFUSAL_STATUSES } from "../src/api-parts.ts";

// 画面の受け皿まで届いた失敗が API の断り(400・401・403・404)なら、応答の番号をその番号にする(#186)。
// TanStack は読み込みで投げた物を全部「画面の失敗」と見て 500 で返すので、権限の無い画面を直接開いただけで
// サーバーの失敗に数えられ、アラームと失敗の数字を汚していた。番号は受け皿(src/pages/ErrorPages.tsx)が
// src/ssr-status.ts で API_STATUS_HEADER に積む。画面が自分で拾った失敗は積まれないので、本物の 500 は 500 のまま。
// TanStack の setResponseStatus は、読み込みで投げた後に 500 で上書きされるので使えない(404 は notFound() がある)。
// ヘッダーは内側だけの物なので、必ず外す。

export { API_STATUS_HEADER };

/**
 * SSR の応答の番号を直す。500 で、受け皿が積んだ番号が API の断りなら、その最初の番号に。
 * どの場合も内側のヘッダーは外す。戻り値の rewrittenFrom は、書き換えたときだけ元の番号(ログに残す)
 */
export function withApiStatus(res: Response): { res: Response; rewrittenFrom?: number } {
  const raw = res.headers.get(API_STATUS_HEADER);
  if (raw === null) return { res };
  const headers = new Headers(res.headers);
  headers.delete(API_STATUS_HEADER);
  const statuses = raw.split(",").map((s) => Number(s.trim()));
  const refusalOnly = statuses.length > 0 && statuses.every((s) => REFUSAL_STATUSES.includes(s));
  const status = res.status === 500 && refusalOnly ? statuses[0] : res.status;
  const rewritten = status !== res.status;
  return {
    res: new Response(res.body, {
      status,
      statusText: rewritten ? "" : res.statusText,
      headers,
    }),
    rewrittenFrom: rewritten ? res.status : undefined,
  };
}

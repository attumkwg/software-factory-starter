// 画面を読むときに API が断った(401・403・404)だけで画面の受け皿が出たら、応答の番号をその番号にする(#186)。
// TanStack は読み込みで投げた物を全部「画面の失敗」と見て 500 で返すので、権限の無い画面を直接開いただけで
// サーバーの失敗に数えられ、アラームと失敗の数字を汚していた。SSR の API 呼び出し(src/api.ts)が失敗の番号を
// API_STATUS_HEADER に積み、ここで読む。ヘッダーは内側だけの物なので、必ず外す。

/** SSR の API の失敗の番号を積む内側のヘッダー(src/api-parts.ts の同じ名前と合わせる。app.test.ts が突き合わせる) */
export const API_STATUS_HEADER = "x-kit-ssr-api-status";

/** 画面の受け皿の番号として写してよい API の断り */
const REFUSALS = new Set([401, 403, 404]);

/**
 * SSR の応答の番号を直す。500 で、積まれた失敗が全部 API の断り(401・403・404)なら、その最初の番号に。
 * 5xx・届かなかった(0)が1つでも混ざれば 500 のまま。どの場合も内側のヘッダーは外す
 */
export function withApiStatus(res: Response): Response {
  const raw = res.headers.get(API_STATUS_HEADER);
  if (raw === null) return res;
  const headers = new Headers(res.headers);
  headers.delete(API_STATUS_HEADER);
  const statuses = raw.split(",").map((s) => Number(s.trim()));
  const refusalOnly = statuses.length > 0 && statuses.every((s) => REFUSALS.has(s));
  const status = res.status === 500 && refusalOnly ? statuses[0] : res.status;
  return new Response(res.body, {
    status,
    statusText: status === res.status ? res.statusText : "",
    headers,
  });
}

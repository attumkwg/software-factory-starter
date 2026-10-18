// 日時の表示。SSR(サーバーは UTC)とブラウザ(利用者の端末)で同じ文字にしないと、
// 読み込み直後に表示がずれる(hydration の不一致)。だから表示のタイムゾーンを固定する。
// 利用者ごとに変えるときは、me にタイムゾーンを持たせてここへ渡す。
const DISPLAY_TIME_ZONE = "Asia/Tokyo";

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ja-JP", { timeZone: DISPLAY_TIME_ZONE });
}

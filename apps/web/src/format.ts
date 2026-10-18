// 日時の表示。**時間帯は組織の設定(me.timeZone)を渡す**(ADR 0005)。
// SSR(サーバーは UTC)とブラウザ(利用者の端末)で同じ時間帯を使わないと、読み込み直後に表示がずれる
// (hydration の不一致)。端末の時間帯(引数なしの toLocaleString)は使わない(Semgrep が止める)。

export function formatDate(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("ja-JP", { timeZone });
}

export function formatDateTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  });
}

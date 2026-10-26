/**
 * 受け取った書き出し(データ・監査ログ)を、読み直さずにブラウザのダウンロードとして保存する
 * (大きい組織でも JS の値にしない)
 */
export function saveAsFile({ blob, filename }: { blob: Blob; filename: string }) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

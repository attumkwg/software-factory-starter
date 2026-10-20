import { encode } from "uqr";

/** QR の周りの余白(マスの数)。仕様の推奨は4 */
const QUIET_ZONE = 4;

/**
 * QR コード(二段階認証の設定で、認証アプリに読ませる)。**ブラウザ(と SSR)の中で描く**。
 * 外の QR のサービスに値を送らない(値は二段階認証の鍵を含む)。
 * 読めない人のために、同じ値を文字でも必ず出す(呼ぶ側で)。label は読み上げに使う。
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { data, size } = encode(value, { ecc: "M", border: 0 });
  // 黒いマスを1本の path にまとめる(マスごとに要素を作らない)
  let d = "";
  data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) d += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`;
    });
  });
  const full = size + QUIET_ZONE * 2;
  return (
    <svg
      className="ui-qrcode"
      viewBox={`0 0 ${full} ${full}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <path className="ui-qrcode__dark" d={d} />
    </svg>
  );
}

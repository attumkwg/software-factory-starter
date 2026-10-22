import { scrubMessage } from "@app/error-reporting/scrub";

// 文の中の値を伏せる(scrubMessage = Sentry に送るときと同じ処理に、ログ向けを2つ足す)。
//   scrubText      … ログの文・出してよい項目の文字列。scrubMessage+区切りのある電話番号
//   scrubErrorText … 失敗の文(err.message・送信待ちの last_error)。上に加えて、英数字でない文字の並び(日本語)を伏せる。
//                    ライブラリの失敗の文は英語で、日本語が入るのはほぼ利用者の値(名前・題名)だから。
//                    自分で投げた日本語の失敗の文も伏せられる(種類・code・スタックの行で場所は分かる)

/** 区切りのある電話番号・カードの番号(090-0000-0000)。UUID の中(前後が - か英数字)は当てない */
const DIGIT_GROUPS = /(?<![\w-])\d{2,5}(?:[- ]\d{2,5}){2,4}(?![\w-])/g;
/** ASCII でない文字の並び(空白をはさんで続くものはまとめて1つ) */
const NON_ASCII = /[^\x20-\x7E\s]+(?:\s+[^\x20-\x7E\s]+)*/g;
/** UUID(行の ID)。scrubMessage の「6桁以上の数字」に当たらないよう、先によけて後で戻す */
const UUID = /\b[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\b/gi;
/** よけた UUID の目印(文に出てこない私用の文字で挟む) */
const HOLE = "";
const HOLES = /(\d+)/g;

export function scrubText(text: string, maxLength = 1000): string {
  const ids: string[] = [];
  const kept = text.replace(UUID, (id) => `${HOLE}${ids.push(id) - 1}${HOLE}`);
  const scrubbed = scrubMessage(kept.replace(DIGIT_GROUPS, "[数字]"), maxLength);
  return scrubbed.replace(HOLES, (_m, i: string) => ids[Number(i)] ?? "");
}

export function scrubErrorText(text: string, maxLength = 1000): string {
  return scrubText(text.replace(NON_ASCII, "[…]"), maxLength);
}

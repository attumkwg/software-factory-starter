import { scrubErrorText } from "./scrub-text.ts";

// 失敗をログに残す形。**値(入力・行の中身・宛先)を出さない。**
//   残すのは: 種類・message(scrubErrorText で値を伏せた物。日本語の並びも伏せる)・決めた項目(code など)・スタックの行(at ...)・原因(cause)
//   ライブラリの失敗の文には値が入る(SMTP の「550 <a@example.com>」・pg の「invalid input syntax: "値"」)。
//   Sentry に送るときと同じ伏せ字に、ログ向けの2つ(電話番号・日本語)を足してから CloudWatch に出す。

export type SerializeErrorOptions = {
  /** そのまま残してよい項目(文字列のときだけ)。既定は code だけ */
  safeFields?: readonly string[];
  /** message の元(既定は err.message)。DB の失敗は SQL の形を使う、など */
  messageOf?: (e: Error & Record<string, unknown>) => string;
};

export function serializeError(
  err: unknown,
  opts: SerializeErrorOptions = {},
  depth = 0,
): Record<string, unknown> {
  if (!(err instanceof Error)) {
    return { type: typeof err, message: "(Error ではない値が投げられた)" };
  }
  const e = err as Error & Record<string, unknown>;
  const out: Record<string, unknown> = { type: e.constructor?.name || e.name || "Error" };
  out.message = scrubErrorText(String(opts.messageOf ? opts.messageOf(e) : e.message), 1000);
  for (const key of opts.safeFields ?? ["code"]) {
    if (typeof e[key] === "string") out[key] = e[key];
  }
  // スタックの1行目は message と同じ(値が入る)なので、「at ...」の行だけを残す
  if (typeof e.stack === "string") {
    out.stack = e.stack
      .split("\n")
      .filter((line) => line.trimStart().startsWith("at "))
      .join("\n");
  }
  if (e.cause !== undefined && depth < 3) out.cause = serializeError(e.cause, opts, depth + 1);
  return out;
}

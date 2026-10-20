import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// お金(docs/adr/0005-money-and-time.md)
//
//   金額 … 「その通貨のいちばん小さい単位」の整数+通貨。円は1円単位、ドルは1セント単位。
//          DB は bigint+char(3)。小数(float)で持たない(0.1 + 0.2 が 0.30000000000000004 になる)。
//   単価・率 … 整数にならないもの(税率 10%・0.5円/回・為替)は小数の文字列 "0.1"。DB は numeric。
//   計算 … 途中は正確な小数(BigInt)で行い、丸めるのは最後に1回、丸め方を必ず指定する。
//
// ここの関数だけで計算する。`amount * 1.1` のような普通の数の掛け算は Semgrep が止める。
// ─────────────────────────────────────────────────────────────────────────────

/** 通貨 → 小数の桁(ISO 4217)。使う通貨だけを足す。 */
export const CURRENCY_DIGITS = { JPY: 0, USD: 2, EUR: 2 } as const;
export type Currency = keyof typeof CURRENCY_DIGITS;
export const CurrencySchema = z.enum(Object.keys(CURRENCY_DIGITS) as [Currency, ...Currency[]]);

/** API・画面とやり取りする金額。amount は最小単位の整数(9千兆まで正確)。 */
export const MoneySchema = z.object({
  amount: z.number().int().refine(Number.isSafeInteger, "金額が大きすぎます"),
  currency: CurrencySchema,
});
export type Money = z.infer<typeof MoneySchema>;

/** 単価・率(整数にならないもの)。数ではなく文字列で受け渡す(JSON の数にすると小数が崩れる)。 */
export const DecimalSchema = z.string().regex(/^-?\d+(\.\d+)?$/, "小数の文字列で書いてください");

/**
 * 丸め方。**どれを使うかは仕様で決め、呼ぶ所で必ず渡す**(既定は置かない)。
 *   floor … 切り捨て(小さい方へ) / ceil … 切り上げ(大きい方へ)
 *   half_up … 四捨五入(0.5 は 0 から遠い方へ) / half_even … 銀行丸め(0.5 は偶数の方へ)
 */
export type Rounding = "floor" | "ceil" | "half_up" | "half_even";

export class CurrencyMismatchError extends Error {
  constructor(a: Currency, b: Currency) {
    super(`通貨が違う金額は足せません(${a} と ${b})`);
  }
}

export function money(amount: number, currency: Currency): Money {
  return MoneySchema.parse({ amount, currency });
}

export function sum(items: readonly Money[], currency: Currency): Money {
  let total = 0n;
  for (const m of items) {
    if (m.currency !== currency) throw new CurrencyMismatchError(currency, m.currency);
    total += BigInt(m.amount);
  }
  return fromBigInt(total, currency);
}

/** 金額 × 小数(税率・割引率・数量×単価など)。結果を1回だけ丸める。 */
export function multiply(m: Money, factor: string, rounding: Rounding): Money {
  const { numerator, denominator } = parseDecimal(factor);
  return fromBigInt(divideRounded(BigInt(m.amount) * numerator, denominator, rounding), m.currency);
}

/**
 * 按分(合計を比で分ける)。端数は大きい順に1ずつ配り、**合計が必ず元と同じ**になる。
 * 例: 100円を 1:1:1 → 34・33・33(33・33・33 にすると1円消える)。
 */
export function allocate(m: Money, ratios: readonly number[]): Money[] {
  if (ratios.length === 0 || ratios.some((r) => !Number.isInteger(r) || r < 0)) {
    throw new Error("比は0以上の整数で、1つ以上");
  }
  const total = BigInt(m.amount);
  const ratioSum = ratios.reduce((a, b) => a + BigInt(b), 0n);
  if (ratioSum === 0n) throw new Error("比の合計が0です");
  const shares = ratios.map((r) => (total * BigInt(r)) / ratioSum);
  let remainder = total - shares.reduce((a, b) => a + b, 0n);
  const step = remainder >= 0n ? 1n : -1n;
  for (let i = 0; remainder !== 0n; i = (i + 1) % shares.length) {
    if (ratios[i] === 0) continue;
    shares[i] = (shares[i] ?? 0n) + step;
    remainder -= step;
  }
  return shares.map((s) => fromBigInt(s, m.currency));
}

/**
 * 消費税(インボイス制度の考え方): **1つの請求書の中で、税率ごとに合計してから1回だけ丸める**。
 * 明細ごとに丸めて足すと、合計が数円ずれる(典型的な「丸めの事故」)。
 */
export function taxByRate(
  lines: readonly { amount: Money; rate: string }[],
  currency: Currency,
  rounding: Rounding,
): { rate: string; base: Money; tax: Money }[] {
  const byRate = new Map<string, Money[]>();
  for (const line of lines) byRate.set(line.rate, [...(byRate.get(line.rate) ?? []), line.amount]);
  return [...byRate].map(([rate, amounts]) => {
    const base = sum(amounts, currency);
    return { rate, base, tax: multiply(base, rate, rounding) };
  });
}

/** 人が入力した金額("1,234.5")を最小単位の整数に。桁が多すぎれば丸めずにエラー。 */
export function parseMajor(text: string, currency: Currency): Money {
  const cleaned = text.replaceAll(",", "").trim();
  const match = cleaned.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error("金額の形ではありません");
  const [, sign, whole, fraction = ""] = match;
  const digits = CURRENCY_DIGITS[currency];
  if (fraction.length > digits) throw new Error(`${currency} は小数 ${digits} 桁までです`);
  const minor = BigInt(`${whole}${fraction.padEnd(digits, "0")}`);
  return fromBigInt(sign === "-" ? -minor : minor, currency);
}

/** 画面に出す形(¥1,234 / $12.34)。小数の計算をせず、文字列のまま Intl に渡す。 */
export function formatMoney(m: Money, locale = "ja-JP"): string {
  const digits = CURRENCY_DIGITS[m.currency];
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: m.currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    // 文字列は丸めずに正確な小数として扱われる(Intl.NumberFormat v3)。型の定義が追いついていないので数として渡す
  }).format(toMajorString(m) as unknown as number);
}

/** 最小単位の整数 → "1234.56"(小数を経由しない)。 */
export function toMajorString(m: Money): string {
  const digits = CURRENCY_DIGITS[m.currency];
  const negative = m.amount < 0;
  const abs = String(Math.abs(m.amount)).padStart(digits + 1, "0");
  const whole = digits === 0 ? abs : abs.slice(0, -digits);
  const fraction = digits === 0 ? "" : `.${abs.slice(-digits)}`;
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

// ── 中身 ──

function parseDecimal(text: string): { numerator: bigint; denominator: bigint } {
  const parsed = DecimalSchema.parse(text);
  const [whole = "0", fraction = ""] = parsed.replace("-", "").split(".");
  const numerator = BigInt(`${whole}${fraction}`) * (parsed.startsWith("-") ? -1n : 1n);
  return { numerator, denominator: 10n ** BigInt(fraction.length) };
}

function divideRounded(n: bigint, d: bigint, rounding: Rounding): bigint {
  const q = n / d; // 0 の方へ切り捨て
  const r = n % d;
  if (r === 0n) return q;
  const negative = n < 0n !== d < 0n;
  // 余りが半分より小さい(-1)・ちょうど(0)・大きい(1)
  const twice = (r < 0n ? -r : r) * 2n;
  const absD = d < 0n ? -d : d;
  const half = twice < absD ? -1 : twice === absD ? 0 : 1;
  const away = roundsAwayFromZero(rounding, negative, half, q % 2n === 0n);
  return away ? (negative ? q - 1n : q + 1n) : q;
}

/** 0 の方へ切り捨てた商を、0 から遠い方へ1つ動かすか。 */
function roundsAwayFromZero(
  rounding: Rounding,
  negative: boolean,
  half: -1 | 0 | 1,
  quotientIsEven: boolean,
): boolean {
  switch (rounding) {
    case "floor":
      return negative;
    case "ceil":
      return !negative;
    case "half_up":
      return half >= 0;
    case "half_even":
      return half > 0 || (half === 0 && !quotientIsEven);
  }
}

function fromBigInt(value: bigint, currency: Currency): Money {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error("金額が大きすぎます");
  }
  return { amount: Number(value), currency };
}

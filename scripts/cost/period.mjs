// 費用を集める期間とお金の換算。日付はどれも日本時間の YYYY-MM-DD(Cost Explorer の終わりの日は含まない)。
// お金は小数で足さない: ドルはセント・円は円の整数にしてから足す(docs/adr/0005-money-and-time.md の考え方)。

const DAY = 86_400_000;
const toDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const ms = (day) => Date.parse(`${day}T00:00:00Z`);

/** 月の初め(YYYY-MM-01)から n か月ずらした月の初め */
export const addMonths = (monthStart, n) => {
  const d = new Date(`${monthStart.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return toDay(d.getTime());
};

/**
 * today から、集める期間を決める。
 *   monthStart … 今月の1日 / tomorrow … 明日(今日の分まで入れる終わり)/ nextMonth … 来月の1日
 *   historyStart … 3か月前の1日(月ごとの並び)/ day … 今月の何日目 / daysInMonth … 今月の日数
 */
export function periodOf(today) {
  const monthStart = `${today.slice(0, 7)}-01`;
  const nextMonth = addMonths(monthStart, 1);
  return {
    today,
    month: today.slice(0, 7),
    monthStart,
    tomorrow: toDay(ms(today) + DAY),
    nextMonth,
    historyStart: addMonths(monthStart, -3),
    day: Math.round((ms(today) - ms(monthStart)) / DAY) + 1,
    daysInMonth: Math.round((ms(nextMonth) - ms(monthStart)) / DAY),
  };
}

/** Cost Explorer の金額(ドルの小数の文字列)をセントの整数に */
export const usdToCents = (amount) => Math.round(Number(amount ?? 0) * 100);

/** セントを円に(usdJpy は 1ドルの円。estimates.yaml の usd_jpy) */
export const centsToJpy = (cents, usdJpy) => Math.round((cents * usdJpy) / 100);

/** 値の合計(整数のまま) */
export const sum = (values) => values.reduce((a, b) => a + b, 0);

/** { 名前: 数 } を足し合わせる(同じ名前は足す) */
export function mergeCounts(...maps) {
  const out = {};
  for (const m of maps) for (const [k, v] of Object.entries(m ?? {})) out[k] = (out[k] ?? 0) + v;
  return out;
}

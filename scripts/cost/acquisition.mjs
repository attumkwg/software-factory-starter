// 獲得のコスト(届け方ごと。推定)。広告費と営業の時間は手入力で、非公開の置き場の cost/inputs/acquisition.csv から読む(リポジトリに置かない)。
// 1社を取るのにいくら = (広告費 + 営業の時間 × 時給)÷ 獲得した組織の数。直近3か月(今月を含む)を足して出す。
// 個社の名前・人ごとの時間は持たない(届け方ごとに足した後だけ)。設計: docs/designs/0043-acquisition-cost.md
import { addMonths } from "./period.mjs";
import { parseCsv } from "./source-people.mjs";

/** 獲得が少ない届け方の印(継続率・1社あたりの原価と同じ。5組織未満) */
export const ACQUISITION_SMALL_BELOW = 5;
/** 足し合わせる月の数(今月を含む) */
export const ACQUISITION_MONTHS = 3;

/**
 * acquisition.csv … month,channel,ad_jpy,sales_hours,won
 *   channel は届け方の賭けの ID(B-NNNN)か名前(「紹介」「展示会」など)。won はその月に有料になった組織の数
 * 形が違う行は落とす。無ければ null
 */
export function readAcquisition(text) {
  if (text === null || text === undefined) return null;
  return parseCsv(text)
    .map((r) => ({
      month: r.month,
      channel: r.channel,
      ad: Math.round(Number(r.ad_jpy || 0)),
      hours: Number(r.sales_hours || 0),
      won: Math.round(Number(r.won || 0)),
    }))
    .filter(
      (r) =>
        /^\d{4}-\d{2}$/.test(r.month ?? "") &&
        r.channel &&
        [r.ad, r.hours, r.won].every((v) => Number.isFinite(v) && v >= 0),
    );
}

/** 届け方ごとの獲得のコスト。rates は rates.json(営業の時間は default の時給で円にする。無ければ円にしない) */
export function acquisitionCost(rows, { month, rates }) {
  const from = addMonths(`${month}-01`, -(ACQUISITION_MONTHS - 1)).slice(0, 7);
  const inRange = rows.filter((r) => r.month >= from && r.month <= month);
  const rate = rates?.default ?? null;
  const by = new Map();
  for (const r of inRange) {
    const c = by.get(r.channel) ?? { channel: r.channel, ad_jpy: 0, sales_hours: 0, won: 0 };
    c.ad_jpy += r.ad;
    c.sales_hours += r.hours;
    c.won += r.won;
    by.set(r.channel, c);
  }
  const channels = [...by.values()].map((c) => {
    const sales = rate === null ? null : Math.round(c.sales_hours * rate);
    const total = c.ad_jpy + (sales ?? 0);
    return {
      ...c,
      sales_hours: Math.round(c.sales_hours * 10) / 10,
      sales_jpy: sales,
      total_jpy: total,
      per_won_jpy: c.won > 0 ? Math.round(total / c.won) : null,
      small: c.won < ACQUISITION_SMALL_BELOW,
    };
  });
  channels.sort((a, b) => b.total_jpy - a.total_jpy);
  const sum = (k) => channels.reduce((a, c) => a + (c[k] ?? 0), 0);
  const won = sum("won");
  const total = sum("total_jpy");
  return {
    from,
    to: month,
    rate_known: rate !== null,
    channels,
    total: {
      ad_jpy: sum("ad_jpy"),
      total_jpy: total,
      won,
      per_won_jpy: won > 0 ? Math.round(total / won) : null,
    },
  };
}

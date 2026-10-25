// 賭けごとの損益(PL)と、/ledger の案。金額は円の整数。人の時間は自動の目安と手入力の2つから「下と上」の幅にする。
// ページ(summary.json)には賭けごとに足した後の数だけを出す(人ごとの金額は出さない)。設計: docs/designs/0020-people-time-and-bet-pl.md
import { isBetId } from "../bets-lib.mjs";
import { actualMinutes } from "./actuals.mjs";
import { UNTAGGED } from "./source-aws.mjs";
import { CORE } from "./source-people.mjs";

const TOTAL = "全体";
const yenOf = (minutesByPerson, rates) =>
  Object.entries(minutesByPerson).reduce(
    (a, [person, min]) => a + (min / 60) * (rates.people?.[person] ?? rates.default ?? 0),
    0,
  );

/** 人ごと・賭けごとの分数(自動の目安) */
export function autoMinutes(prs) {
  const out = {};
  for (const pr of prs ?? []) {
    const bet = out[pr.bet] ?? {};
    for (const [person, min] of Object.entries(pr.minutes)) bet[person] = (bet[person] ?? 0) + min;
    out[pr.bet] = bet;
  }
  return out;
}

/** 人ごと・賭けごとの分数(手入力) */
export function manualMinutes(time) {
  const out = {};
  for (const r of time ?? []) {
    const bet = out[r.bet] ?? {};
    bet[r.person] = (bet[r.person] ?? 0) + r.hours * 60;
    out[r.bet] = bet;
  }
  return out;
}

const sumMin = (m) => Object.values(m ?? {}).reduce((a, b) => a + b, 0);

/** 共通の費用(土台・タグなし・共通の SaaS・Actions)を、賭けの人の時間の割合で配る */
function shares(method, auto, manual, bets) {
  if (method === "none") return {};
  const totalOf = (base) => bets.reduce((a, b) => a + sumMin(base[b]), 0);
  // 決めた方に賭けの時間が無ければ、もう一方で配る(PR に bet: が無い月でも、手入力があれば配れる)
  const first = method === "people_manual" ? manual : auto;
  const base = totalOf(first) > 0 ? first : first === auto ? manual : auto;
  const total = totalOf(base);
  if (total === 0) return {};
  return Object.fromEntries(bets.map((b) => [b, sumMin(base[b]) / total]));
}

const verdictOf = (row) => {
  if (row.people_low === null) return "単価なし";
  if (row.revenue === null) return "売上なし";
  if (row.profit_high < 0) return "赤字";
  if (row.profit_low >= 0) return "黒字";
  return "分からない(幅の中)";
};

const hoursOf = (min) => (min === null || min === undefined ? null : Math.round(min / 6) / 10);
const yenOrNull = (y) => (y === null || y === undefined ? null : Math.round(y));
// 実績(週の記録)があれば、推定の幅ではなく実績を人の費用にする(仕様 0044)
const peopleYens = (x) =>
  yenOrNull(x.actualYen) !== null
    ? [x.actualYen]
    : [x.autoYen, x.manualYen].filter((v) => v !== null);

function row(bet, x) {
  const people = peopleYens(x);
  const peopleLow = people.length ? Math.round(Math.min(...people)) : null;
  const peopleHigh = people.length ? Math.round(Math.max(...people)) : null;
  const fixed = x.infra + x.saas + x.shared;
  const r = {
    bet,
    stage: x.stage ?? null,
    revenue: x.revenue,
    infra: x.infra,
    saas: x.saas,
    shared: x.shared,
    hours_auto: Math.round(x.autoMin / 6) / 10,
    hours_manual: hoursOf(x.manualMin),
    hours_actual: hoursOf(x.actualMin),
    people_actual_yen: yenOrNull(x.actualYen),
    people_auto_yen: yenOrNull(x.autoYen),
    people_manual_yen: yenOrNull(x.manualYen),
    people_low: peopleLow,
    people_high: peopleHigh,
    cost_low: fixed + (peopleLow ?? 0),
    cost_high: fixed + (peopleHigh ?? 0),
  };
  r.profit_low = r.revenue === null ? null : r.revenue - r.cost_high;
  r.profit_high = r.revenue === null ? null : r.revenue - r.cost_low;
  r.verdict = verdictOf(r);
  return r;
}

const sumAll = (byBet, fn) => Object.values(byBet ?? {}).reduce((a, m) => a + fn(m), 0);

/** PL に出す賭け(どこかに出てきた B-NNNN) */
const betsOf = (lists) => [...new Set(lists.flat())].filter((b) => isBetId(b)).sort();

/** 全体の行(直接の原価+共通+人) */
function totalRow({ awsByBet, saasItems, saasCore, shared, revenue, auto, manual, actual, rates }) {
  const direct = (byBet) => sumAll(byBet, (v) => v) - (byBet[CORE] ?? 0) - (byBet[UNTAGGED] ?? 0);
  return row(TOTAL, {
    revenue: Object.keys(revenue).length ? sumAll(revenue, (v) => v) : null,
    infra: direct(awsByBet),
    saas: saasItems.reduce((a, i) => a + i.monthly_jpy, 0) - saasCore,
    shared,
    autoMin: sumAll(auto, sumMin),
    manualMin: manual ? sumAll(manual, sumMin) : null,
    autoYen: rates ? sumAll(auto, (m) => yenOf(m, rates)) : null,
    manualYen: manual && rates ? sumAll(manual, (m) => yenOf(m, rates)) : null,
    actualMin: actual ? sumAll(actual, sumMin) : null,
    actualYen: actual && rates ? sumAll(actual, (m) => yenOf(m, rates)) : null,
  });
}

/**
 * 賭けごとの PL。
 *   awsByBet … AWS のタグ Bet ごとの円(タグなしは UNTAGGED)/ saasItems … saas.yaml の今月の物(bet つき)
 *   actionsJpy … Actions の金額(共通)/ prs … source-people の PR / inputs … readInputs の戻り値 / stages … 賭けの段階
 */
export function makePl({ awsByBet, saasItems, actionsJpy, prs, inputs, allocation, stages }) {
  const auto = autoMinutes(prs);
  const manual = inputs.time ? manualMinutes(inputs.time) : null;
  const actual = inputs.actuals ? actualMinutes(inputs.actuals) : null;
  const revenue = {};
  for (const r of inputs.revenue ?? []) revenue[r.bet] = (revenue[r.bet] ?? 0) + r.jpy;
  const saasBy = (b) => saasItems.filter((i) => i.bet === b).reduce((a, i) => a + i.monthly_jpy, 0);
  const bets = betsOf([
    Object.keys(awsByBet),
    saasItems.map((i) => i.bet),
    Object.keys(auto),
    Object.keys(manual ?? {}),
    Object.keys(actual ?? {}),
    Object.keys(revenue),
  ]);
  const shared = (awsByBet[CORE] ?? 0) + (awsByBet[UNTAGGED] ?? 0) + saasBy(CORE) + actionsJpy;
  const share = shares(allocation, auto, manual ?? {}, bets);
  const allocated = Object.values(share).length ? shared : 0;
  const rates = inputs.rates;
  const yenIf = (m, on) => (on && rates ? yenOf(m ?? {}, rates) : null);
  const one = (b, extra) =>
    row(b, {
      stage: stages[b],
      revenue: revenue[b] ?? null,
      infra: awsByBet[b] ?? 0,
      saas: saasBy(b),
      autoMin: sumMin(auto[b]),
      manualMin: manual ? sumMin(manual[b]) : null,
      autoYen: yenIf(auto[b], true),
      manualYen: yenIf(manual?.[b], manual !== null),
      actualMin: actual ? sumMin(actual[b]) : null,
      actualYen: yenIf(actual?.[b], actual !== null),
      ...extra,
    });
  const rows = bets.map((b) => one(b, { shared: Math.round(shared * (share[b] ?? 0)) }));
  const core = one(CORE, { revenue: null, infra: 0, saas: 0, shared: shared - allocated });
  const total = totalRow({
    awsByBet,
    saasItems,
    saasCore: saasBy(CORE),
    shared,
    revenue,
    auto,
    manual,
    actual,
    rates,
  });
  return { allocation, shared_jpy: shared, allocated_jpy: allocated, rows: [...rows, core], total };
}

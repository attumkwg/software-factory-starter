// 集めた費用(aws-<環境>・github-actions・saas・estimates)を、ページの元(summary.json)にまとめる。
// 金額は円の整数。ドルの物はセントで足してから、estimates.yaml の usd_jpy で円にする。読めなかった物は notes に出す(0円として隠さない)。

import { acquisitionCost } from "./acquisition.mjs";
import { budgetStatus } from "./budgets.mjs";
import { centsToJpy, mergeCounts, periodOf, sum } from "./period.mjs";
import { makePl } from "./pl.mjs";
import { targetOf, tenantCost } from "./tenants.mjs";

const AWS_ACCOUNTS = ["stg", "prod", "dev"];
const sorted = (counts) =>
  Object.entries(counts)
    .map(([name, jpy]) => ({ name, jpy }))
    .filter((r) => r.jpy !== 0)
    .sort((a, b) => b.jpy - a.jpy);
const toJpy = (cents, rate) =>
  Object.fromEntries(Object.entries(cents ?? {}).map(([k, v]) => [k, centsToJpy(v, rate)]));

function awsPart(entries, rate, period) {
  const accounts = AWS_ACCOUNTS.map((a) => entries[`aws-${a}`]).filter((e) => e?.ok);
  const thisMonth = (a) => a.data.months.find((m) => m.month === period.month)?.total_cents ?? 0;
  const byAccount = Object.fromEntries(accounts.map((a) => [a.data.account, thisMonth(a)]));
  const tm = (field) => mergeCounts(...accounts.map((a) => a.data.this_month?.[field]));
  const months = {};
  for (const a of accounts)
    for (const m of a.data.months) months[m.month] = (months[m.month] ?? 0) + m.total_cents;
  const daily = {};
  for (const a of accounts)
    for (const d of a.data.this_month?.daily ?? []) daily[d.date] = (daily[d.date] ?? 0) + d.cents;
  const rest = accounts.map((a) => a.data.forecast_rest_cents);
  return {
    read: accounts.map((a) => a.data.account),
    byAccountJpy: toJpy(byAccount, rate),
    totalJpy: centsToJpy(sum(Object.values(byAccount)), rate),
    restJpy: rest.every((r) => r === null) ? null : centsToJpy(sum(rest.map((r) => r ?? 0)), rate),
    byComponent: toJpy(tm("by_component"), rate),
    byEnvironment: toJpy(tm("by_environment"), rate),
    byBet: toJpy(tm("by_bet"), rate),
    byPullRequest: toJpy(tm("by_pull_request"), rate),
    byService: toJpy(
      mergeCounts(
        ...accounts.map((a) => a.data.months.find((m) => m.month === period.month)?.by_service),
      ),
      rate,
    ),
    months: Object.entries(months)
      .sort()
      .map(([month, cents]) => ({ month, jpy: centsToJpy(cents, rate) })),
    daily: Object.entries(daily)
      .sort()
      .map(([date, cents]) => ({ date, jpy: centsToJpy(cents, rate) })),
  };
}

const saasBy = (items, category) =>
  sum(items.filter((i) => (i.category ?? "other") === category).map((i) => i.monthly_jpy));

/** 区分ごとの実績と見積もり(estimates.yaml の lines の id と同じ) */
function categories(est, parts) {
  const actual = {
    infra: (parts.aws.byAccountJpy.stg ?? 0) + (parts.aws.byAccountJpy.prod ?? 0),
    preview_ci: (parts.aws.byAccountJpy.dev ?? 0) + parts.actionsJpy,
    ai: saasBy(parts.saasItems, "ai"),
    scan: saasBy(parts.saasItems, "scan"),
  };
  const lines = (est?.lines ?? []).map((l) => {
    const jpy = actual[l.id] ?? 0;
    const status = jpy > l.max ? "over" : jpy < l.min * 0.5 ? "under" : "ok";
    return { id: l.id, name: l.name, jpy, min: l.min, max: l.max, status };
  });
  const other = saasBy(parts.saasItems, "other");
  return other > 0 ? [...lines, { id: "other", name: "そのほかの SaaS", jpy: other }] : lines;
}

/** 動いている物ごと(AWS は Component のタグ・AWS の外は1つずつ) */
function components(parts) {
  const rows = { ...parts.aws.byComponent };
  if (parts.actionsJpy > 0) rows["GitHub Actions"] = parts.actionsJpy;
  for (const i of parts.saasItems) rows[i.name] = (rows[i.name] ?? 0) + i.monthly_jpy;
  return sorted(rows);
}

/** 人の時間と賭けごとの PL(people を渡したときだけ。仕様 0020) */
function plOf(entries, parts, people) {
  const prs = entries["people-prs"]?.ok ? entries["people-prs"].data.prs : null;
  if (!people || !(prs || people.inputs.time || people.inputs.actuals)) return null;
  return makePl({
    awsByBet: parts.aws.byBet,
    saasItems: parts.saasItems,
    actionsJpy: parts.actionsJpy,
    prs: prs ?? [],
    inputs: people.inputs,
    allocation: people.allocation,
    stages: people.stages,
  });
}

/** 人の時間の実績(週の記録)で足りない物(仕様 0044) */
function actualNotes(actuals) {
  if (!actuals)
    return [
      "人の時間の実績: 無い(cost/inputs/actuals.csv)。推定の幅で出した(上場の準備には週の記録が要る)",
    ];
  const unapproved = actuals.rows.filter((r) => !r.approved_by).length;
  return [
    ...(actuals.bad > 0 ? [`人の時間の実績: 形の合わない行 ${actuals.bad}行を数えていない`] : []),
    ...(unapproved > 0 ? [`人の時間の実績: 確かめた人の無い行 ${unapproved}行(未確認)`] : []),
  ];
}

/** 1社あたりの原価(按分の元 tenants.json と、本番の AWS があるときだけ。仕様 0042) */
function tenantCostOf(entries, rate, period, people) {
  const shares = people?.inputs?.tenants;
  const prod = entries["aws-prod"]?.ok ? entries["aws-prod"].data : null;
  if (!shares || !prod) return null;
  const toJpy = (cents) => centsToJpy(cents ?? 0, rate);
  const thisMonth = prod.months.find((m) => m.month === period.month)?.total_cents;
  const target = targetOf({
    shares,
    prodMonths: prod.months,
    prodThisMonthJpy: toJpy(thisMonth),
    period,
    toJpy,
  });
  return target ? tenantCost(shares, target) : null;
}

/** 賭けごとの予算の枠(仕様 0054)。形の合わない行は notes に足す */
function budgetsOf(people, { pl, period, notes }) {
  const budgets = budgetStatus(people?.inputs.budgets ?? null, { pl, period });
  if (budgets?.bad) notes.push(`賭けの予算の枠: 形の合わない行 ${budgets.bad}行を数えていない`);
  return budgets;
}

/** 人の時間と PL で足りない物(0円として隠さない) */
const peopleNotes = (inputs, prs) => [
  ...(prs?.ok ? [] : [noteOf("人の時間(PR からの目安)", prs)]),
  ...(prs?.ok && prs.data.truncated
    ? ["人の時間(PR からの目安): PR が多く、先頭の分だけ数えた"]
    : []),
  ...(inputs.rates
    ? []
    : ["人の時給: 無い(非公開の置き場の cost/inputs/rates.json)。人の費用を円にしていない"]),
  ...(inputs.time ? [] : ["人の時間の手入力: 無い(cost/inputs/time.csv)。自動の目安だけ"]),
  ...(inputs.revenue ? [] : ["売上: 無い(cost/inputs/revenue.csv)"]),
  ...actualNotes(inputs.actuals),
  ...(inputs.tenants
    ? []
    : ["1社あたりの原価: 按分の元が無い(cost/inputs/tenants.json。API の tenant-shares)"]),
  ...(inputs.acquisition
    ? []
    : ["獲得のコスト: 無い(cost/inputs/acquisition.csv。届け方ごとの広告費・営業の時間)"]),
];

const noteOf = (name, e) => (e ? `${name}: 読めなかった(${e.reason})` : `${name}: 集めていない`);

export function makeSummary(entries, { today, generatedAt, people }) {
  const period = periodOf(today);
  const est = entries.estimates?.ok ? entries.estimates.data : null;
  const rate = est?.usd_jpy ?? 150;
  const actions = entries["github-actions"]?.ok ? entries["github-actions"].data : null;
  const parts = {
    aws: awsPart(entries, rate, period),
    actionsJpy: centsToJpy(actions?.billing?.paid_cents ?? 0, rate),
    saasItems: entries.saas?.ok ? entries.saas.data.items : [],
  };
  const saasJpy = sum(parts.saasItems.map((i) => i.monthly_jpy));
  const totalJpy = parts.aws.totalJpy + parts.actionsJpy + saasJpy;
  // 月末の見込み: AWS は Cost Explorer の残りの見込み・Actions は今の日割りを伸ばす・SaaS は月額のまま
  const stretch = (jpy) => Math.round((jpy * period.daysInMonth) / period.day);
  const forecastJpy =
    parts.aws.totalJpy +
    (parts.aws.restJpy ?? stretch(parts.aws.totalJpy) - parts.aws.totalJpy) +
    stretch(parts.actionsJpy) +
    saasJpy;
  const notes = [
    ...AWS_ACCOUNTS.filter((a) => !entries[`aws-${a}`]?.ok).map((a) =>
      noteOf(`AWS(${a})`, entries[`aws-${a}`]),
    ),
    ...[
      ["github-actions", "GitHub Actions"],
      ["saas", "そのほかの SaaS"],
      ["estimates", "見積もり"],
    ]
      .filter(([k]) => !entries[k]?.ok)
      .map(([k, name]) => noteOf(name, entries[k])),
  ];
  const pl = plOf(entries, parts, people);
  const tenant_cost = tenantCostOf(entries, rate, period, people);
  if (people) notes.push(...peopleNotes(people.inputs, entries["people-prs"]));
  if (people?.inputs.tenants && !tenant_cost)
    notes.push(
      `1社あたりの原価: 按分の元の月(${people.inputs.tenants.month})の本番の AWS が読めなかった`,
    );
  // 獲得のコスト(届け方ごと。仕様 0043)
  const acquisition = people?.inputs.acquisition
    ? acquisitionCost(people.inputs.acquisition, {
        month: period.month,
        rates: people.inputs.rates,
      })
    : null;
  const budgets = budgetsOf(people, { pl, period, notes });
  return {
    month: period.month,
    pl,
    tenant_cost,
    acquisition,
    budgets,
    today,
    day: period.day,
    days_in_month: period.daysInMonth,
    generated_at: generatedAt,
    usd_jpy: rate,
    total_jpy: totalJpy,
    forecast_jpy: forecastJpy,
    estimate: est
      ? {
          stage: est.name,
          min: sum(est.lines.map((l) => l.min)),
          max: sum(est.lines.map((l) => l.max)),
        }
      : null,
    categories: categories(est, parts),
    components: components(parts),
    environments: sorted(parts.aws.byEnvironment),
    bets: sorted(
      mergeCounts(parts.aws.byBet, ...parts.saasItems.map((i) => ({ [i.bet]: i.monthly_jpy }))),
    ),
    pull_requests: sorted(parts.aws.byPullRequest),
    aws_services: sorted(parts.aws.byService).slice(0, 10),
    aws_months: parts.aws.months,
    aws_daily: parts.aws.daily,
    actions: actions
      ? {
          private: actions.private,
          minutes: actions.minutes_total,
          workflows: actions.workflows.slice(0, 10),
        }
      : null,
    saas_without_amount: entries.saas?.ok ? (entries.saas.data.without_amount ?? []) : [],
    notes,
  };
}

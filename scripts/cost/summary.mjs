// 集めた費用(aws-<環境>・github-actions・saas・estimates)を、ページの元(summary.json)にまとめる。
// 金額は円の整数。ドルの物はセントで足してから、estimates.yaml の usd_jpy で円にする。読めなかった物は notes に出す(0円として隠さない)。
import { centsToJpy, mergeCounts, periodOf, sum } from "./period.mjs";

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

const noteOf = (name, e) => (e ? `${name}: 読めなかった(${e.reason})` : `${name}: 集めていない`);

export function makeSummary(entries, { today, generatedAt }) {
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
  return {
    month: period.month,
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

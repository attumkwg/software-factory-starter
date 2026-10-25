// 費用の集め先(AWS の Cost Explorer。cost.yml が環境ごとの役割で、アカウントを1つずつ読む)。
// 1回の呼び出しが $0.01 なので、1アカウントにつき6回まで(下の QUERIES と見込み)。金額はセントの整数にして返す。
import { periodOf, usdToCents } from "./period.mjs";

/** タグなしの費用の名前(隠さずに出す) */
export const UNTAGGED = "(タグなし)";

const metric = (m) => usdToCents(m?.UnblendedCost?.Amount);

/** Cost Explorer の Groups を { 名前: セント } に。タグは「Key$値」なので値だけ。値が空ならタグなし */
export function groupsToCents(groups) {
  const out = {};
  for (const g of groups ?? []) {
    const raw = String(g.Keys?.[0] ?? "");
    const name = raw.includes("$") ? raw.slice(raw.indexOf("$") + 1) || UNTAGGED : raw;
    const cents = metric(g.Metrics);
    if (cents !== 0) out[name] = (out[name] ?? 0) + cents;
  }
  return out;
}

const usage = (ctx, start, end, granularity, groupBy) =>
  ctx.aws([
    "ce",
    "get-cost-and-usage",
    "--time-period",
    `Start=${start},End=${end}`,
    "--granularity",
    granularity,
    "--metrics",
    "UnblendedCost",
    ...(groupBy ? ["--group-by", groupBy] : []),
  ]);

/** 今月の、タグごとの合計(1回) */
function byTag(ctx, p, key) {
  const res = usage(ctx, p.monthStart, p.tomorrow, "MONTHLY", `Type=TAG,Key=${key}`);
  if (!res.ok) return res;
  return { ok: true, data: groupsToCents(res.data?.ResultsByTime?.flatMap((r) => r.Groups)) };
}

/** 前の3か月と今月の、AWS のサービスごと(1回) */
function months(ctx, p) {
  const res = usage(ctx, p.historyStart, p.tomorrow, "MONTHLY", "Type=DIMENSION,Key=SERVICE");
  if (!res.ok) return res;
  return {
    ok: true,
    data: (res.data?.ResultsByTime ?? []).map((r) => {
      const byService = groupsToCents(r.Groups);
      return {
        month: String(r.TimePeriod?.Start).slice(0, 7),
        total_cents: Object.values(byService).reduce((a, b) => a + b, 0),
        by_service: byService,
        estimated: r.Estimated === true,
      };
    }),
  };
}

/** 今月の日ごと(1回) */
function daily(ctx, p) {
  const res = usage(ctx, p.monthStart, p.tomorrow, "DAILY");
  if (!res.ok) return res;
  return {
    ok: true,
    data: (res.data?.ResultsByTime ?? []).map((r) => ({
      date: r.TimePeriod?.Start,
      cents: metric(r.Total),
    })),
  };
}

/** 月末までの残りの見込み(1回)。始めたばかりのアカウントは見込みが出ないので null */
function forecast(ctx, p) {
  const res = ctx.aws([
    "ce",
    "get-cost-forecast",
    "--time-period",
    `Start=${p.today},End=${p.nextMonth}`,
    "--metric",
    "UNBLENDED_COST",
    "--granularity",
    "MONTHLY",
  ]);
  return res.ok ? usdToCents(res.data?.Total?.Amount) : null;
}

/**
 * 1アカウントの費用。account は stg / prod / dev(dev は PR ごとの環境があるので、日ごとの代わりに PR ごと)。
 * 戻り値: { ok, data: { account, months, this_month: { by_environment, by_component, by_bet, daily | by_pull_request }, forecast_rest_cents } }
 */
export async function awsCost(ctx, account) {
  const p = periodOf(ctx.today);
  const history = months(ctx, p);
  if (!history.ok) return history;
  const thisMonth = {};
  for (const [field, key] of [
    ["by_environment", "Environment"],
    ["by_component", "Component"],
    ["by_bet", "Bet"],
  ]) {
    const res = byTag(ctx, p, key);
    thisMonth[field] = res.ok ? res.data : null;
  }
  if (account === "dev") {
    const res = byTag(ctx, p, "PullRequest");
    thisMonth.by_pull_request = res.ok ? res.data : null;
  } else {
    const res = daily(ctx, p);
    thisMonth.daily = res.ok ? res.data : null;
  }
  return {
    ok: true,
    data: {
      account,
      currency: "USD",
      months: history.data,
      this_month: thisMonth,
      forecast_rest_cents: forecast(ctx, p),
    },
  };
}

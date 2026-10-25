// 賭けごとの予算の枠(人の時間+インフラ+SaaS+共通の配り分)と、超えそうなときの知らせ。設計: docs/designs/0054-plans-and-bet-budgets.md
// 枠は金額なので、非公開の置き場の cost/inputs/budgets.csv にだけ置く(リポジトリに置かない)。
// 今月の使った額は賭けごとの PL(pl.mjs)の原価の上の端。月末の見込みは、月の中で増える分(インフラ・人・共通の配り分)を日割りで伸ばし、
// 月額の SaaS はそのまま足す。知らせ(Slack・Actions の要約)には賭けの ID と割合だけを出す(金額は出さない)。

/** 既定の注意の線(枠の何 % の見込みで知らせるか) */
export const BUDGET_WARN_PCT = 80;

/**
 * budgets.csv … bet,monthly_jpy,from,until,warn_pct
 *   bet は B-NNNN。from・until は YYYY-MM(その月を含む)。warn_pct は空なら 80
 * 形が違う行は bad に数えて落とす。無ければ null
 */
export function readBudgets(text, parse) {
  if (text === null || text === undefined) return null;
  const rows = [];
  let bad = 0;
  for (const r of parse(text)) {
    const monthly = Number(r.monthly_jpy);
    const warn = r.warn_pct ? Number(r.warn_pct) : BUDGET_WARN_PCT;
    const months = [r.from, r.until].every((m) => /^\d{4}-\d{2}$/.test(m ?? ""));
    if (!/^B-\d{4}$/.test(r.bet ?? "") || !months || !(monthly > 0) || !(warn > 0 && warn <= 100)) {
      bad += 1;
      continue;
    }
    rows.push({ bet: r.bet, monthly: Math.round(monthly), from: r.from, until: r.until, warn });
  }
  return { rows, bad };
}

/** 今月の使った額と月末の見込み(PL の行。無ければ 0) */
function spentOf(plRow, period) {
  if (!plRow) return { spent: 0, projected: 0 };
  const growing = plRow.infra + plRow.shared + (plRow.people_high ?? 0);
  const spent = growing + plRow.saas;
  const projected = Math.round((growing * period.daysInMonth) / period.day) + plRow.saas;
  return { spent, projected };
}

/**
 * 今月が期間の中の枠ごとに、使った額・見込み・割合・状態(over = 見込みが枠を超える / warn = 注意の線を超える / ok)。
 * 期間を過ぎた枠は ended(続けるなら枠を引き直す)
 */
export function budgetStatus(budgets, { pl, period }) {
  if (!budgets) return null;
  const rows = [];
  for (const b of budgets.rows) {
    if (b.from > period.month) continue;
    if (b.until < period.month) {
      rows.push({ bet: b.bet, monthly_jpy: b.monthly, until: b.until, status: "ended" });
      continue;
    }
    const { spent, projected } = spentOf(
      pl?.rows.find((r) => r.bet === b.bet),
      period,
    );
    const pct = Math.round((projected / b.monthly) * 100);
    const status = pct >= 100 ? "over" : pct >= b.warn ? "warn" : "ok";
    rows.push({
      bet: b.bet,
      monthly_jpy: b.monthly,
      until: b.until,
      spent_jpy: spent,
      projected_jpy: projected,
      pct,
      warn_pct: b.warn,
      status,
    });
  }
  return { rows, bad: budgets.bad };
}

/** 知らせの文(賭けの ID と割合だけ。金額は出さない)。知らせる物が無ければ空 */
export function budgetAlerts(status, month) {
  return (status?.rows ?? [])
    .filter((r) => r.status === "over" || r.status === "warn")
    .map((r) =>
      r.status === "over"
        ? `⚠ 賭け ${r.bet}: ${month} は予算の枠を超える見込み(枠の ${r.pct}%)。続けるか・枠を引き直すかを決める(費用のページ)`
        : `賭け ${r.bet}: ${month} は予算の枠の ${r.pct}% の見込み(注意の線 ${r.warn_pct}%)`,
    );
}

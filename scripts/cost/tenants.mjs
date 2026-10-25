// 1社あたりの原価(推定)。本番の AWS を、組織の大きさの帯ごとの「人数・データの行の数・書き込みの数」の割合で按分する。
// 按分の元は API の運営のコマンド tenant-shares が出し、人が非公開の置き場の cost/inputs/tenants.json に置く(組織の ID は無い)。
// 元が3つあるので、1社あたりは「下と上」の幅で出す(どれか1つに決めない)。設計: docs/designs/0042-tenant-cost.md

const BASES = ["users", "rows", "writes"];
const BASIS_NAME = { users: "人数", rows: "データの行の数", writes: "書き込みの数" };

const minMax = (values) =>
  values.length === 0
    ? { low: null, high: null }
    : { low: Math.round(Math.min(...values)), high: Math.round(Math.max(...values)) };

/** 本番の AWS のうち、按分の元の月の分(過ぎた月は Cost Explorer の実績・今月は月末の見込み) */
export function targetOf({ shares, prodMonths, prodThisMonthJpy, period, toJpy }) {
  if (shares.month === period.month)
    return {
      jpy: Math.round((prodThisMonthJpy * period.daysInMonth) / period.day),
      how: "今月の見込み",
    };
  const m = prodMonths.find((x) => x.month === shares.month);
  return m ? { jpy: toJpy(m.total_cents), how: "実績" } : null;
}

/** tenants.json(tenant-shares の出力)と、按分する金額から、帯ごとの1社あたり */
export function tenantCost(shares, target) {
  const bases = BASES.filter((k) => (shares.totals?.[k] ?? 0) > 0);
  const bands = (shares.bands ?? []).map((b) => {
    const each = bases.map((k) => (target.jpy * b[k]) / shares.totals[k] / b.tenants);
    return { band: b.band, tenants: b.tenants, small: b.small, ...minMax(each) };
  });
  const largest = minMax(bases.map((k) => (target.jpy * (shares.largestPct?.[k] ?? 0)) / 100));
  return {
    month: shares.month,
    target_jpy: target.jpy,
    target_how: target.how,
    tenants_total: shares.tenantsTotal,
    small_below: shares.smallBelow,
    bases: bases.map((k) => BASIS_NAME[k]),
    average: minMax(shares.tenantsTotal > 0 ? [target.jpy / shares.tenantsTotal] : []),
    bands,
    largest,
  };
}

/** 非公開の入力の tenants.json を読む(tenant-shares の1行目。mode は落とす)。形が違えば null */
export function parseShares(text) {
  if (!text) return null;
  const { mode: _mode, ...shares } = JSON.parse(text);
  return Array.isArray(shares.bands) && shares.totals && /^\d{4}-\d{2}$/.test(shares.month)
    ? shares
    : null;
}

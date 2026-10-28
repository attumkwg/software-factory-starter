// ループを閉じる部品(中身だけ): 記録の古さ・合議の見込みと実測の比べ・ROI の幅・計画の星。
// 読み書きは kpi.mjs・bets.mjs。決まりは docs/guides/kpi.md の 8〜10・仕様 0083。

const DAY = 24 * 60 * 60 * 1000;
const daysBetween = (from, to) => Math.floor((Date.parse(to) - Date.parse(from)) / DAY);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ""));
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// ── 1. 記録の古さ(計測が止まったら気づく)──────────────────────────────

/** 記録が古い・無いと見なす日数(4週) */
export const STALE_DAYS = 28;

/** 追う指標(北極星・入力・守り)のうち、最後の記録が古い・無い物の知らせの並び */
export function staleNotes(report, today) {
  return report
    .filter((r) => r.kind !== "watch")
    .flatMap((r) => {
      if (!r.last) return [`${r.id}: まだ1件も測っていない(毎週の手順で records に1行)`];
      const age = daysBetween(r.last.date, today);
      return age > STALE_DAYS ? [`${r.id}: 最後の記録が ${age} 日前(${STALE_DAYS}日を超えた)`] : [];
    });
}

/** rollout・adopted の賭けが動かす KPI に、記録が1件も無い物の知らせの並び */
export function unmeasuredBetNotes(bets, recordedIds) {
  return bets
    .filter((b) => ["rollout", "adopted"].includes(b.stage))
    .flatMap((b) =>
      b.kpis
        .filter((k) => !recordedIds.has(k))
        .map((k) => `${b.id}(${b.stage})が動かす ${k} に、まだ記録が無い`),
    );
}

// ── 2. 合議の見込みと実測(合議の当たり外れ)────────────────────────────

/** forecasts の1行の誤り。{ date, kpi, council, low, high, by } */
export function forecastProblems(forecasts, kpiIds) {
  const problems = [];
  for (const [i, f] of (forecasts ?? []).entries()) {
    const at = `forecasts の ${i + 1}行目`;
    if (!isDate(f.date) || !isDate(f.by)) problems.push(`${at}: date と by は YYYY-MM-DD で`);
    if (!kpiIds.has(f.kpi)) problems.push(`${at}: kpi「${f.kpi}」が木に無い`);
    if (!f.council) problems.push(`${at}: どの合議の見込みか(council)が無い`);
    if (!isNum(f.low) || !isNum(f.high) || f.low > f.high)
      problems.push(`${at}: low と high は数で、low ≦ high`);
  }
  return problems;
}

/**
 * 見込みごとに、期限(by)までの最後の記録と比べる。
 * 当たり = 幅の中 / 外れ = 幅の外 / 測っていない = 期限を過ぎたのに記録が無い / まだ = 期限の前
 */
export function forecastResults(doc, today) {
  const records = doc?.records ?? [];
  return (doc?.forecasts ?? []).map((f) => {
    if (f.by > today) return { ...f, result: "まだ" };
    const last = records
      .filter((r) => r.kpi === f.kpi && r.date <= f.by && isNum(r.value))
      .sort((a, b) => a.date.localeCompare(b.date))
      .at(-1);
    if (!last) return { ...f, result: "測っていない" };
    const hit = last.value >= f.low && last.value <= f.high;
    return { ...f, actual: last.value, result: hit ? "当たり" : "外れ" };
  });
}

/** 合議ごとの当たり率(当たり ÷ 確かめられた数)。外れが半分を超えた合議は回し直しの合図 */
export function councilHitRates(results) {
  const by = new Map();
  for (const r of results.filter((x) => x.result === "当たり" || x.result === "外れ")) {
    const cur = by.get(r.council) ?? { council: r.council, hits: 0, checked: 0 };
    cur.checked += 1;
    if (r.result === "当たり") cur.hits += 1;
    by.set(r.council, cur);
  }
  return [...by.values()].map((c) => ({
    ...c,
    rate: c.hits / c.checked,
    redo: c.checked >= 2 && c.hits / c.checked < 0.5,
  }));
}

// ── 3. ROI の幅(金額はリポジトリに書かず、倍率と月数だけを残す)────────────────

/**
 * ROI の幅と回収の月数。cost は原価の累計の幅、gainMonthly は得た物(月)の幅、months は経った月数。
 * ROI = (得た物の累計 − 原価の累計) ÷ 原価の累計。悪い方は「得た物が少なく、原価が多い」組み合わせ
 */
export function roiRange({ cost, gainMonthly, months }) {
  const roi = (gain, c) => (c > 0 ? (gain * months - c) / c : Number.NaN);
  const payback = (gain, c) => (gain > 0 ? c / gain : Number.POSITIVE_INFINITY);
  return {
    roiLow: roi(gainMonthly.low, cost.high),
    roiHigh: roi(gainMonthly.high, cost.low),
    paybackLow: payback(gainMonthly.high, cost.low),
    paybackHigh: payback(gainMonthly.low, cost.high),
  };
}

// ── 4. 計画の星(合議の記録の表から、機械で出せる2つの軸)───────────────────

/** 根拠の強さの割合から ★(記録・事例が多いほど高い。推測だけなら ★1) */
export function evidenceStars(rows) {
  if (rows.length === 0) return 1;
  const strong = rows.filter((r) => /^(記録|事例)/.test(r.evidence)).length / rows.length;
  return Math.max(1, Math.min(5, Math.round(1 + strong * 4)));
}

/**
 * 価値の ★: 推測だけの賛成は数えない。賛成 1・条件つき 0.5・反対 0・拒否 −1 を、根拠が記録・事例の人だけで平均する。
 * 拒否が1人でもいれば ★2 まで(出す前の合否の一覧を満たすまで)
 */
export function valueStars(rows) {
  const score = { 賛成: 1, 条件つき: 0.5, 反対: 0, 拒否: -1 };
  const counted = rows.filter((r) => /^(記録|事例)/.test(r.evidence));
  const veto = rows.some((r) => r.vote === "拒否");
  if (counted.length === 0) return 1;
  const avg = counted.reduce((s, r) => s + (score[r.vote] ?? 0), 0) / counted.length;
  const stars = Math.max(1, Math.min(5, Math.round(1 + Math.max(0, avg) * 4)));
  return veto ? Math.min(stars, 2) : stars;
}

// 費用のページ(静的な HTML の1枚)。外の部品・外の読み込みは無し(CSS と SVG を中に)。ページは非公開の置き場にだけ置く(ADR 0032)。
// 色は1系列の青(棒・線)と、見積もりを超えたときだけ注意の赤(記号と文字も付ける。色だけに頼らない)。ライトとダーク。
const esc = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export const yen = (n) =>
  n === null || n === undefined ? "—" : `${Math.round(n).toLocaleString("ja-JP")}円`;

const CSS = `
:root{color-scheme:light;--page:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;--grid:#e1e0d9;--base:#c3c2b7;--series:#2a78d6;--band:rgba(42,120,214,.16);--critical:#d03b3b;--ring:rgba(11,11,11,.10)}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--page:#0d0d0d;--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;--base:#383835;--series:#3987e5;--band:rgba(57,135,229,.22);--critical:#d03b3b;--ring:rgba(255,255,255,.10)}}
*{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--ink);font:15px/1.6 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif}
main{max-width:960px;margin:0 auto;padding:24px 16px 48px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:0 0 12px}
.sub{color:var(--ink2);margin:0 0 20px}.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:20px}
.card{background:var(--surface);border:1px solid var(--ring);border-radius:10px;padding:16px;margin-bottom:16px}
.tile .label{color:var(--ink2);font-size:13px}.tile .value{font-size:28px;font-weight:650;font-variant-numeric:tabular-nums}.tile .note{color:var(--muted);font-size:12px}
.bars{display:grid;grid-template-columns:minmax(90px,30%) 1fr auto;gap:6px 12px;align-items:center}
.bars .name{color:var(--ink2);overflow-wrap:anywhere}.bars .num{font-variant-numeric:tabular-nums;text-align:right}
.track{position:relative;height:14px}.bar{height:14px;background:var(--series);border-radius:0 4px 4px 0;min-width:2px}
.band{position:absolute;top:-3px;bottom:-3px;background:var(--band);border-radius:4px}
.over{color:var(--critical);font-weight:600}.muted{color:var(--muted)}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--grid)}td.n,th.n{text-align:right}
svg text{fill:var(--muted);font-size:11px}.axis{stroke:var(--base)}.gridline{stroke:var(--grid)}
.split{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}ul{margin:0;padding-left:20px}
`;

/** 横棒(1系列)。band を渡すと見積もりの幅を後ろに敷く */
function bars(rows, { band } = {}) {
  if (rows.length === 0) return `<p class="muted">まだ無い</p>`;
  const top = Math.max(...rows.map((r) => Math.max(r.jpy, r.max ?? 0)), 1);
  const pct = (n) => `${((n / top) * 100).toFixed(2)}%`;
  const cells = rows.map((r) => {
    const over = r.status === "over";
    const bandEl =
      band && r.max !== undefined
        ? `<div class="band" style="left:${pct(r.min)};width:${pct(Math.max(r.max - r.min, top * 0.015))}" title="見積もり ${yen(r.min)}〜${yen(r.max)}"></div>`
        : "";
    const mark = over ? ` <span class="over">⚠ 見積もりを超えた</span>` : "";
    return `<div class="name">${esc(r.name)}</div><div class="track">${bandEl}<div class="bar" style="width:${pct(r.jpy)}" title="${esc(r.name)}: ${yen(r.jpy)}"></div></div><div class="num">${yen(r.jpy)}${mark}</div>`;
  });
  return `<div class="bars">${cells.join("")}</div>`;
}

/** 月ごとの縦棒(SVG。AWS だけ) */
function monthsChart(months) {
  if (months.length === 0) return `<p class="muted">まだ無い</p>`;
  const w = 640;
  const h = 180;
  const pad = 28;
  const top = Math.max(...months.map((m) => m.jpy), 1);
  const slot = (w - pad * 2) / months.length;
  const bw = Math.min(56, slot * 0.6);
  const cols = months.map((m, i) => {
    const bh = Math.max(2, ((h - pad * 2) * m.jpy) / top);
    const x = pad + i * slot + (slot - bw) / 2;
    const y = h - pad - bh;
    return `<g><title>${esc(m.month)}: ${yen(m.jpy)}</title><path d="M${x},${h - pad} V${y + 4} q0,-4 4,-4 h${bw - 8} q4,0 4,4 V${h - pad} Z" fill="var(--series)"/><text x="${x + bw / 2}" y="${h - pad + 16}" text-anchor="middle">${esc(m.month)}</text><text x="${x + bw / 2}" y="${y - 6}" text-anchor="middle">${yen(m.jpy)}</text></g>`;
  });
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="AWS の月ごとの費用"><line class="axis" x1="${pad}" x2="${w - pad}" y1="${h - pad}" y2="${h - pad}"/>${cols.join("")}</svg>`;
}

/** 日ごとの小さな線(SVG。AWS だけ) */
function dailyChart(days) {
  if (days.length < 2) return `<p class="muted">2日分そろうと出る</p>`;
  const w = 640;
  const h = 80;
  const top = Math.max(...days.map((d) => d.jpy), 1);
  const x = (i) => 4 + (i * (w - 8)) / (days.length - 1);
  const y = (v) => h - 6 - ((h - 12) * v) / top;
  const pts = days.map((d, i) => `${x(i).toFixed(1)},${y(d.jpy).toFixed(1)}`).join(" ");
  const dots = days
    .map(
      (d, i) =>
        `<circle cx="${x(i)}" cy="${y(d.jpy)}" r="6" fill="transparent"><title>${esc(d.date)}: ${yen(d.jpy)}</title></circle>`,
    )
    .join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="AWS の日ごとの費用"><line class="gridline" x1="0" x2="${w}" y1="${h - 6}" y2="${h - 6}"/><polyline points="${pts}" fill="none" stroke="var(--series)" stroke-width="2" stroke-linejoin="round"/>${dots}</svg>`;
}

const table = (rows, head) =>
  rows.length === 0
    ? `<p class="muted">まだ無い</p>`
    : `<table><thead><tr><th>${esc(head)}</th><th class="n">今月</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="n">${yen(r.jpy)}</td></tr>`).join("")}</tbody></table>`;

const card = (title, body) => `<section class="card"><h2>${esc(title)}</h2>${body}</section>`;

function tiles(s) {
  const est = s.estimate;
  const over = est && s.forecast_jpy > est.max;
  return `<div class="tiles">
<div class="card tile"><div class="label">今月の合計(${s.day}日目まで)</div><div class="value">${yen(s.total_jpy)}</div><div class="note">AWS・Actions・AI・SaaS</div></div>
<div class="card tile"><div class="label">月末の見込み</div><div class="value">${yen(s.forecast_jpy)}</div><div class="note">${over ? `<span class="over">⚠ 見積もりの上を超える見込み</span>` : "AWS は Cost Explorer の見込み・ほかは日割り"}</div></div>
<div class="card tile"><div class="label">見積もり(${esc(est?.stage ?? "未設定")})</div><div class="value">${est ? `${yen(est.min)}〜${yen(est.max)}` : "—"}</div><div class="note">docs/cost/estimates.yaml</div></div>
</div>`;
}

function actionsBlock(a) {
  if (!a) return `<p class="muted">読めなかった</p>`;
  const rows = a.workflows.map(
    (w) =>
      `<tr><td>${esc(w.name)}</td><td class="n">${w.runs}回</td><td class="n">${w.minutes}分</td></tr>`,
  );
  return `<p class="muted">${a.private ? "非公開のリポジトリ(枠を超えた分が金額になる)" : "公開のリポジトリ(標準の実行環境は無料)"}・今月 ${a.minutes}分</p><table><thead><tr><th>ワークフロー</th><th class="n">実行</th><th class="n">分</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

/** AI の回数と時間(金額は「何にいくら」の AI の行。saas.yaml の手書き) */
function aiBlock(a) {
  if (!a) return `<p class="muted">読めなかった</p>`;
  const n = (v, unit) => (v === null ? "—" : `${v}${unit}`);
  return `<p class="muted">金額は saas.yaml に人が書き写す(請求の画面を見る)。上限と知らせは docs/guides/cost-dashboard.md の「AI の上限」</p><table><tbody><tr><td>背景の AI の実行</td><td class="n">${n(a.background_runs, "回")}</td><td class="n">${n(a.background_minutes, "分")}</td></tr><tr><td>AI が手伝った PR(今月作った PR のうち)</td><td class="n">${n(a.ai_prs, "本")}</td><td class="n">${a.prs === null ? "—" : `${a.prs}本中`}</td></tr></tbody></table>`;
}

const range = (lo, hi) => (lo === null ? "—" : lo === hi ? yen(lo) : `${yen(lo)}〜${yen(hi)}`);
const VERDICT = { 赤字: "⚠ 赤字", 黒字: "黒字" };

/** 賭けごとの損益(PL)。人の時間は自動の目安と手入力の幅(仕様 0020) */
function plBlock(pl) {
  if (!pl) return "";
  const tr = (r, name) => {
    const v = VERDICT[r.verdict] ?? r.verdict;
    const cls = r.verdict === "赤字" ? ' class="over"' : "";
    return `<tr><td>${esc(name ?? r.bet)}${r.stage ? ` <span class="muted">${esc(r.stage)}</span>` : ""}</td><td class="n">${yen(r.revenue)}</td><td class="n">${yen(r.infra + r.saas)}</td><td class="n">${yen(r.shared)}</td><td class="n">${r.hours_actual === null ? `${r.hours_auto}h / ${r.hours_manual ?? "—"}h` : `実績 ${r.hours_actual}h`}</td><td class="n">${range(r.people_low, r.people_high)}</td><td class="n">${range(r.cost_low, r.cost_high)}</td><td class="n">${range(r.profit_low, r.profit_high)}</td><td${cls}>${esc(v)}</td></tr>`;
  };
  const head =
    "<tr><th>賭け</th><th class=n>売上</th><th class=n>インフラ・SaaS</th><th class=n>共通の配り分</th><th class=n>人の時間(目安/手入力・実績)</th><th class=n>人の費用</th><th class=n>原価</th><th class=n>粗利</th><th>判定</th></tr>";
  const rows = pl.rows.map((r) => tr(r, r.bet === "core" ? "土台(core)" : r.bet));
  const how =
    {
      people_auto: "人の時間(PR からの目安)の割合で配った",
      people_manual: "人の時間(手入力)の割合で配った",
      none: "配っていない(土台の行に残す)",
    }[pl.allocation] ?? pl.allocation;
  return card(
    "賭けごとの損益(PL。推定)",
    `<p class="muted">人の時間は推定: 自動の目安(今月作った PR × 1件あたりの分数。docs/cost/people.yaml)と手入力(週ごとの割合)の幅。実績(週の記録 actuals.csv)があれば実績で出す(開発の段階の区分は ledger.csv。会計・税の当てはめは専門家が確かめる)。共通の費用 ${yen(pl.shared_jpy)} は${esc(how)}。人の評価には使わない。</p><div style="overflow-x:auto"><table><thead>${head}</thead><tbody>${rows.join("")}${tr(pl.total, "全体")}</tbody></table></div>`,
  );
}

/** 1社あたりの原価(本番の AWS の按分。仕様 0042)。組織の名前・ID は無い */
function tenantBlock(t) {
  if (!t) return "";
  const small = (b) =>
    b.small ? ` <span class="muted">(${t.small_below}組織未満。割合が大きく揺れる)</span>` : "";
  const rows = t.bands.map(
    (b) =>
      `<tr><td>${esc(b.band)}${small(b)}</td><td class="n">${b.tenants}</td><td class="n">${range(b.low, b.high)}</td></tr>`,
  );
  return card(
    "1社あたりの原価(本番の AWS の按分。推定)",
    `<p class="muted">按分の元 ${esc(t.month)}(${esc(t.bases.join("・"))}の割合の幅)・本番の AWS ${yen(t.target_jpy)}(${esc(t.target_how)})・${t.tenants_total}組織。人の時間・SaaS・stg は入れていない。固定の費用も含む平均なので、組織が増えると下がる。</p><table><thead><tr><th>組織の大きさ</th><th class="n">組織</th><th class="n">1社あたり(月)</th></tr></thead><tbody>${rows.join("")}<tr><td>全体の平均</td><td class="n">${t.tenants_total}</td><td class="n">${range(t.average.low, t.average.high)}</td></tr><tr><td>いちばん大きい組織</td><td class="n">1</td><td class="n">${range(t.largest.low, t.largest.high)}</td></tr></tbody></table>`,
  );
}

/** 獲得のコスト(届け方ごと。仕様 0043)。個社の名前・人ごとの時間は無い */
function acquisitionBlock(a) {
  if (!a) return "";
  const per = (c) =>
    `${yen(c.per_won_jpy)}${c.small && c.won > 0 ? ` <span class="muted">(${c.won}組織。少ない)</span>` : ""}`;
  const tr = (c, name) =>
    `<tr><td>${esc(name ?? c.channel)}</td><td class="n">${yen(c.ad_jpy)}</td><td class="n">${c.sales_hours ?? "—"}h</td><td class="n">${yen(c.sales_jpy)}</td><td class="n">${yen(c.total_jpy)}</td><td class="n">${c.won}</td><td class="n">${per(c)}</td></tr>`;
  const head =
    "<tr><th>届け方</th><th class=n>広告費など</th><th class=n>営業の時間</th><th class=n>営業の費用</th><th class=n>合計</th><th class=n>獲得</th><th class=n>1社を取るのに</th></tr>";
  return card(
    `獲得のコスト(届け方ごと。${esc(a.from)}〜${esc(a.to)} の合計・推定)`,
    `<p class="muted">広告費と営業の時間は手入力(非公開の置き場の acquisition.csv)。営業の費用は時給の既定(rates.json の default)で円にした${a.rate_known ? "" : "(時給が無いので円にしていない)"}。獲得が5組織未満の届け方は、1社の違いで大きく動く。</p><div style="overflow-x:auto"><table><thead>${head}</thead><tbody>${a.channels.map((c) => tr(c)).join("")}${tr({ ...a.total, sales_hours: null, sales_jpy: null, small: false }, "全体")}</tbody></table></div>`,
  );
}

/** 賭けごとの予算の枠(仕様 0054)。見込みが注意の線を超えたら ⚠ */
const BUDGET_STATUS = {
  over: "⚠ 超える見込み",
  warn: "⚠ 注意",
  ok: "枠の中",
  ended: "期限を過ぎた",
};
function budgetBlock(b) {
  if (!b || b.rows.length === 0) return "";
  const rows = b.rows.map((r) => {
    const cls = r.status === "over" || r.status === "warn" ? ' class="over"' : "";
    const pct = r.pct === undefined ? "—" : `${r.pct}%`;
    return `<tr><td>${esc(r.bet)}</td><td class="n">${yen(r.monthly_jpy)}</td><td class="n">${yen(r.spent_jpy)}</td><td class="n">${yen(r.projected_jpy)}</td><td class="n">${pct}</td><td>${esc(r.until)}</td><td${cls}>${esc(BUDGET_STATUS[r.status])}</td></tr>`;
  });
  return card(
    "賭けごとの予算の枠(今月。推定)",
    `<p class="muted">枠は非公開の置き場の budgets.csv。使った額は PL の原価の上の端(人の時間を含む)、月末の見込みはインフラ・人・共通の配り分を日割りで伸ばし、月額の SaaS を足した。注意の線(既定 80%)を超えたら cost.yml が Slack に知らせる(賭けの ID と割合だけ)。</p><div style="overflow-x:auto"><table><thead><tr><th>賭け</th><th class=n>枠(月)</th><th class=n>今月これまで</th><th class=n>月末の見込み</th><th class=n>枠の</th><th>期限</th><th>状態</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`,
  );
}

export function renderHtml(s) {
  const notes = [
    ...s.notes,
    ...s.saas_without_amount.map((n) => `${n}: 金額なし(docs/cost/saas.yaml)`),
  ];
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>費用 ${esc(s.month)}</title><style>${CSS}</style></head>
<body><main>
<h1>費用 ${esc(s.month)}</h1>
<p class="sub">${esc(s.today)} 時点(作った時刻 ${esc(s.generated_at)})・1ドル = ${s.usd_jpy}円で換算・金額は目安(請求書が正)</p>
${tiles(s)}
${card("何にいくら(動いている物ごと)", bars(s.components))}
${card("見積もりと実績(区分ごと。薄い帯が見積もりの幅)", bars(s.categories, { band: true }))}
${plBlock(s.pl)}
${budgetBlock(s.budgets)}
${tenantBlock(s.tenant_cost)}
${acquisitionBlock(s.acquisition)}
<div class="split">
${card("環境ごと(AWS)", table(s.environments, "環境"))}
${card("賭けごと(AWS のタグ Bet と SaaS)", table(s.bets, "賭け"))}
</div>
${card("AWS の月ごと(前の3か月と今月)", monthsChart(s.aws_months))}
${card("AWS の日ごと(今月)", dailyChart(s.aws_daily))}
<div class="split">
${card("AWS のサービスごと(上の10)", table(s.aws_services, "サービス"))}
${card("PR ごとの環境(AWS の dev)", table(s.pull_requests, "PR"))}
</div>
${card("AI の回数と時間", aiBlock(s.ai))}
${card("GitHub Actions", actionsBlock(s.actions))}
${notes.length > 0 ? card("読めなかった物・足りない物", `<ul>${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`) : ""}
</main></body></html>
`;
}

// 週の数字を Markdown にする(Actions の要約と手元の画面)。決裁用と改善用を分ける。人の名前は出さない。
const show = (v, unit = "") => (v === null || v === undefined ? "—" : `${v}${unit}`);

function decisionTable(report) {
  const rows = report.decision.weeks.map((w) =>
    [
      w.week,
      w.deploys,
      show(w.leadTimeHours, "時間"),
      show(w.changeFailurePct, "%"),
      show(w.restoreMinutes, "分"),
      w.merged,
      show(w.aiPct, "%"),
      show(w.aiUntouchedPct, "%"),
    ].join(" | "),
  );
  return [
    "| 週(月曜) | 本番のデプロイ | リードタイム(中央値) | 変更の失敗率 | 復旧の時間(中央値) | マージした PR | AI が手伝った | AI の PR で人の介入なし |",
    "|---|---|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r} |`),
  ];
}

function prTable(prs) {
  if (prs.length === 0) return ["(先週マージした PR は無い)"];
  return [
    "| PR | AI | 危険度 | 人が答えた問い | 人の手直し | 開いてからマージまで |",
    "|---|---|---|---|---|---|",
    ...prs.map(
      (p) =>
        `| #${p.number} | ${p.ai ? "はい" : "—"} | ${show(p.risk)} | ${p.questions} | ${p.ai ? p.humanCommits : "—"} | ${show(p.openToMergeHours, "時間")} |`,
    ),
  ];
}

const specLines = (rows, empty) =>
  rows.length === 0
    ? [`- ${empty}`]
    : rows.map((s) => `- ${s.number} ${s.title}${s.days === null ? "" : `(${s.days}日)`}`);

const REASON_NAMES = ["要求", "設計", "AI の仮決め", "実装"];
const reasonText = (reasons) => REASON_NAMES.map((k) => `${k} ${reasons[k] ?? 0}`).join("・");
const percentOf = (v) => (v === undefined || v === null ? "—" : `${Math.round(v * 100)}%`);

/** 引き渡し(作る → 確かめる)の節。設計書 0077。report.handoff が無ければ出さない */
function handoffSection(handoff) {
  if (!handoff) return [];
  const rows = handoff.weeks.map(
    (w) =>
      `| ${w.week} | ${w.rounds} | ${show(w.waitDays, "日")} | ${show(w.acceptPct, "%")} | ${reasonText(w.reasons)} | ${w.rework} | ${show(w.designReworkPct, "%")} |`,
  );
  const last =
    handoff.last.length === 0
      ? ["- なし"]
      : handoff.last.map(
          (r) =>
            `- ${r.path} 第${r.no}回(待ち ${show(r.waitDays, "日")}・PdM ${percentOf(r.pdm)}・全体 ${percentOf(r.all)}・外れ ${reasonText(r.reasons)})`,
        );
  return [
    "## 引き渡し(作る → 確かめる。詰まっている継ぎ目を探す)",
    "",
    "| 週(月曜) | 受け入れの回 | 実装の完了から受け入れまで(中央値) | 受け入れの点数 | 外れた理由 | 作り直し | うち設計が原因 |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
    "先週の受け入れ(docs/acceptance。外れが「要求」なら解決済みの論点に書き戻したか):",
    ...last,
    "",
  ];
}

export function renderMarkdown(report) {
  const imp = report.improvement;
  return [
    `# 週の数字(${report.weeks.from} 〜 ${report.weeks.to} の週。${report.today} に作った)`,
    "",
    "## 決裁用(任せる範囲・投資を決める。チームで1つの数)",
    "",
    ...decisionTable(report),
    "",
    `- 仕様の在庫: 作る待ち(承認済み・まだ作っていない)${report.decision.specsReady}件・承認待ち(下書き)${report.decision.specsDraft}件`,
    "- ボットの PR(依存の更新など)は「マージした PR」に入れない。人の介入は AI が手伝った PR だけで数える",
    "- 数字は決める材料の1つ。人の評価には使わない(docs/guides/metrics.md)",
    "",
    ...handoffSection(report.handoff),
    `## 改善用(${imp.week} の週。何を機械に回すかを決める)`,
    "",
    ...prTable(imp.prs),
    "",
    "人が答えた問いの種類(同じ種類が続いたら、観点・ルール・テストにする):",
    ...(imp.kinds.length === 0 ? ["- なし"] : imp.kinds.map((k) => `- ${k.kind}: ${k.count}件`)),
    "",
    "障害の振り返り:",
    ...(imp.incidents.length === 0
      ? ["- なし"]
      : imp.incidents.map(
          (i) =>
            `- ${i.file}(戻るまで ${show(i.minutes, "分")}・変更が原因 ${i.change === null ? "未記入" : i.change ? "はい" : "いいえ"})`,
        )),
    "",
    "仕様の在庫(作る待ち):",
    ...specLines(imp.specs.ready, "なし(次に作る仕様が足りない。/new-feature か /bet で)"),
    "",
    "承認待ち(下書き):",
    ...specLines(imp.specs.drafts, "なし"),
    ...(report.notes.length === 0
      ? []
      : ["", "読めなかった物:", ...report.notes.map((n) => `- ${n}`)]),
    "",
  ].join("\n");
}

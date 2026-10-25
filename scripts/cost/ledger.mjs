// /ledger の案の CSV(月1回)。賭けごとに、人の時間を PR の作業の種類と賭けの段階で「資産の候補・費用・除却の候補」に分け、
// インフラ・SaaS・共通の配り分は「費用(運用)」にする。案と根拠(PR の番号)まで。確定は人と専門家(docs/guides/bets-and-assets.md)。
// 金額が入るので、非公開の置き場か手元にだけ置く(リポジトリにコミットしない)。
import { actualPhases, PHASES, phaseOfStage } from "./actuals.mjs";
import { CORE } from "./source-people.mjs";

const HEAD = [
  "月",
  "賭け",
  "段階",
  "もと",
  "区分の案",
  "時間(自動の目安)",
  "金額(円・自動の目安)",
  "金額(円・手入力を配る)",
  "根拠",
];
const cell = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const rate = (rates, person) => rates?.people?.[person] ?? rates?.default ?? null;

function peopleRows(month, bet, prs, plRow, rates) {
  const groups = {};
  for (const pr of prs.filter((p) => p.bet === bet)) {
    const g = groups[pr.proposal] ?? { minutes: 0, yen: 0, prs: [] };
    for (const [person, min] of Object.entries(pr.minutes)) {
      g.minutes += min;
      g.yen += rates ? (min / 60) * (rate(rates, person) ?? 0) : 0;
    }
    g.prs.push(`#${pr.number}`);
    groups[pr.proposal] = g;
  }
  const autoTotal = Object.values(groups).reduce((a, g) => a + g.minutes, 0);
  const manualYen = plRow?.hours_manual === null ? null : (plRow?.people_manual_yen ?? null);
  return Object.entries(groups).map(([proposal, g]) => [
    month,
    bet,
    plRow?.stage ?? "",
    "人の時間",
    proposal,
    Math.round(g.minutes / 6) / 10,
    rates ? Math.round(g.yen) : "",
    manualYen === null || autoTotal === 0 ? "" : Math.round((manualYen * g.minutes) / autoTotal),
    g.prs.join(" "),
  ]);
}

/** 実績(週の記録)の行。賭け × 開発の段階ごと。根拠は記録の行の数・未確認の数・段階の案との違い(仕様 0044) */
function actualRows(month, plRow, groups, rates) {
  return groups
    .filter((g) => g.bet === plRow.bet)
    .map((g) => {
      const minutes = Object.values(g.minutes).reduce((a, b) => a + b, 0);
      const yen = Object.entries(g.minutes).reduce(
        (a, [person, min]) => a + (min / 60) * (rate(rates, person) ?? 0),
        0,
      );
      const expected = plRow.bet === CORE ? "運用" : phaseOfStage(plRow.stage);
      const notes = [
        `週の記録 ${g.rows}行`,
        ...(g.unapproved > 0 ? [`未確認 ${g.unapproved}行`] : []),
        ...(g.phase === expected ? [] : [`賭けの段階からの案は「${expected}」`]),
      ];
      return [
        month,
        plRow.bet,
        plRow.stage ?? "",
        `人の時間(実績・${g.phase})`,
        PHASES[g.phase],
        Math.round(minutes / 6) / 10,
        rates ? Math.round(yen) : "",
        "",
        notes.join("・"),
      ];
    });
}

/** CSV の文字列(1行目が見出し)。pl は makePl の戻り値(行ごとの people_manual_yen を含む)。actuals は readActuals の戻り値 */
export function makeLedgerCsv({ month, prs, rates, pl, actuals = null }) {
  const rows = [];
  const groups = actualPhases(actuals);
  for (const r of pl.rows) {
    rows.push(...actualRows(month, r, groups, rates));
    rows.push(...peopleRows(month, r.bet, prs ?? [], r, rates));
    const running = r.infra + r.saas + r.shared;
    if (running > 0)
      rows.push([
        month,
        r.bet,
        r.stage ?? "",
        r.bet === CORE
          ? "インフラ・SaaS・Actions(配っていない共通の分)"
          : "インフラ・SaaS・共通の配り分",
        "費用(運用)",
        "",
        running,
        "",
        "AWS のタグ Bet・saas.yaml",
      ]);
  }
  return `${[HEAD, ...rows].map((r) => r.map(cell).join(",")).join("\n")}\n`;
}

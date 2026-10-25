// 人の時間の実績(週の記録)と、開発の段階(研究開発・制作・運用)の区分。上場の準備の原価計算で、見積もりの幅ではなく工数の実績を出すため。
// 実績は人が週に1回、非公開の置き場の cost/inputs/actuals.csv に書く(リポジトリに置かない)。確かめた人の欄が空の行は「未確認」として数える。
// 区分は案まで。会計・税の当てはめは専門家(税理士・監査法人)が確かめる。設計: docs/designs/0044-actual-hours.md

/** 開発の段階(actuals.csv の phase)と、会計区分の案 */
export const PHASES = {
  研究開発: "費用",
  制作: "資産の候補",
  運用: "費用",
};

/** 賭けの段階から、開発の段階の案(bets-and-assets.md の案の表と同じ考え。作業の種類は記録の人が選ぶ) */
export function phaseOfStage(stage) {
  if (stage === "rollout" || stage === "adopted") return "制作";
  if (["idea", "cpf", "psf"].includes(stage)) return "研究開発";
  return "運用";
}

/**
 * actuals.csv … date,person,bet,phase,hours,approved_by
 *   date はその記録の始まりの日(ふつうは週の月曜。月をまたぐ週は月ごとに2行に分ける)。month の行だけ
 *   phase は 研究開発 / 制作 / 運用。approved_by は確かめた人(@名前。空なら未確認)
 * 形が違う行は bad に数えて落とす。ファイルが無ければ null
 */
export function readActuals(text, month, parse) {
  if (text === null || text === undefined) return null;
  const rows = parse(text).filter((r) => String(r.date ?? "").startsWith(month));
  const ok = [];
  let bad = 0;
  for (const r of rows) {
    const hours = Number(r.hours);
    if (!r.person || !r.bet || !(r.phase in PHASES) || !Number.isFinite(hours) || hours < 0) {
      bad += 1;
      continue;
    }
    ok.push({
      date: r.date,
      person: r.person,
      bet: r.bet,
      phase: r.phase,
      hours,
      approved_by: r.approved_by || null,
    });
  }
  return { rows: ok, bad };
}

/** 人ごと・賭けごとの分数(実績) */
export function actualMinutes(actuals) {
  const out = {};
  for (const r of actuals?.rows ?? []) {
    const bet = out[r.bet] ?? {};
    bet[r.person] = (bet[r.person] ?? 0) + r.hours * 60;
    out[r.bet] = bet;
  }
  return out;
}

/** 賭け × 開発の段階ごとの、時間・人ごとの分・未確認の行の数(ledger.csv の元) */
export function actualPhases(actuals) {
  const out = new Map();
  for (const r of actuals?.rows ?? []) {
    const key = `${r.bet}\u0000${r.phase}`;
    const g = out.get(key) ?? { bet: r.bet, phase: r.phase, minutes: {}, rows: 0, unapproved: 0 };
    g.minutes[r.person] = (g.minutes[r.person] ?? 0) + r.hours * 60;
    g.rows += 1;
    if (!r.approved_by) g.unapproved += 1;
    out.set(key, g);
  }
  // 並びは環境の言語の設定に頼らない(賭けは文字の順・段階は 研究開発 → 制作 → 運用 の順)
  const order = Object.keys(PHASES);
  const byText = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  return [...out.values()].sort((a, b) =>
    a.bet === b.bet ? order.indexOf(a.phase) - order.indexOf(b.phase) : byText(a.bet, b.bet),
  );
}

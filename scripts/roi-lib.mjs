// 資産の累計と ROI・PR の「動かす KPI」と賭けの突き合わせ・北極星の週ごとの分母と分子(中身だけ。GitHub もファイルも読まない)。
// 読み書きは roi.mjs(pnpm kpi --roi)。決まりは docs/guides/kpi.md の 10・12・仕様 0094。
// 【実測】PR の数・マージした週・KPI の記録 /【推定】人の時間(PR × docs/cost/people.yaml の分数)・得る物の見込み。金額は扱わない。
import { checkPrBody, stripComments } from "./bets-lib.mjs";
import { addDays, daysBetween, mondayOf, toDate, todayInTokyo } from "./checkup/phase.mjs";
import { prMinutes } from "./cost/source-people.mjs";
import { kpiRefs } from "./kpi-lib.mjs";
import { roiRange } from "./loop-lib.mjs";
import { questionsOf } from "./metrics/lib.mjs";
import { rangeOf } from "./verdict-lib.mjs";

/** 届いた(使う人に出した)段階 */
export const REACHED = ["rollout", "adopted"];
/** 1人日の分(8時間) */
export const DAY_MINUTES = 8 * 60;
/** 1か月の日数(経った月数 = 日数 ÷ 30) */
const MONTH_DAYS = 30;
/** 人が答えた問い1つに、別にかかったとみなす分(幅の上の端。docs/kit/roi.md の 2 と同じ) */
const QUESTION_MINUTES = 5;

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const round1 = (n) => Math.round(n * 10) / 10;

/** PR の本文の「- 動かす KPI:」の値(注・バッククォートを外す。無ければ空) */
export function kpiFieldOf(body) {
  const line = stripComments(body ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("- 動かす KPI:"));
  return (line?.slice("- 動かす KPI:".length) ?? "").replaceAll("`", "").trim();
}

// gh pr list の author({ login, is_bot })を、費用のページの書き方(ボットは …[bot])に
const loginOf = (author) => {
  const login = String(author?.login ?? "");
  return author?.is_bot ? `${login.replace("app/", "")}[bot]` : login;
};

/**
 * マージした PR 1件の事実(gh pr list --json number,author,labels,body,comments,reviews,mergedAt)。
 * 人の名前・題名・本文は持たない。分は費用のページと同じ式(prMinutes)。幅の上の端は問い1つ × 5分を足す
 */
export function prFactOf(pr, { config, stages }) {
  const login = loginOf(pr.author);
  const checked = checkPrBody(pr.body ?? "", { author: login, bets: stages });
  const work = checked.work ?? "";
  const shaped = {
    user: { login },
    labels: pr.labels,
    body: pr.body,
    comments: (pr.comments ?? []).length,
  };
  const reviews = (pr.reviews ?? []).map((r) => ({ user: { login: loginOf(r.author) } }));
  const total = sum(Object.values(prMinutes(shaped, reviews, config).minutes));
  const questions = questionsOf(pr.body).count;
  const kpiField = kpiFieldOf(pr.body);
  const day = todayInTokyo(new Date(pr.mergedAt));
  return {
    number: pr.number,
    bot: login.endsWith("[bot]"),
    bet: work.startsWith("bet:") ? work.slice(4).trim().slice(0, 6) : null,
    proposal: checked.proposal ?? null,
    kpiField,
    kpis: kpiRefs(kpiField),
    minutes: {
      low: total,
      high: total + questions * (config.minutes.question ?? QUESTION_MINUTES),
    },
    day,
    week: mondayOf(day),
  };
}

/** 賭けのファイル(parseBet の結果)から、数えるのに要る物。届いた日 = 最初の rollout(か adopted)の小石の日 */
export function betFactOf(id, bet) {
  const reachedRow = (bet.pebbles?.rows ?? []).find((r) => REACHED.includes(r.cells[1]));
  return {
    id,
    stage: bet.stage,
    kpis: kpiRefs(bet.kpi),
    gain: rangeOf(bet.gain),
    reachedOn: reachedRow?.cells[0],
  };
}

// ── 1. PR の「動かす KPI」と賭けの突き合わせ ─────────────────────────────

/**
 * 空(「- 動かす KPI:」が無い・空)と、合わない(賭けの PR なのに、賭けの動かす KPI のどれも指していない)の並び。
 * ボットの PR と、動かす KPI をまだ持たない賭け(idea・cpf)の PR は見ない
 */
export function kpiMismatches(prs, bets) {
  const kpisOf = new Map(bets.map((b) => [b.id, b.kpis]));
  return prs
    .filter((p) => !p.bot)
    .flatMap((p) => {
      if (!p.kpiField) return [{ number: p.number, bet: p.bet, reason: "空" }];
      const want = p.bet ? (kpisOf.get(p.bet) ?? []) : [];
      if (want.length === 0 || p.kpis.some((k) => want.includes(k))) return [];
      return [
        {
          number: p.number,
          bet: p.bet,
          reason: `合わない(PR は ${p.kpis.join("・") || p.kpiField}・賭けは ${want.join("・")})`,
        },
      ];
    });
}

// ── 2. 資産の累計と ROI ─────────────────────────────────────────────

const daysOf = (prs) => ({
  low: sum(prs.map((p) => p.minutes.low)) / DAY_MINUTES,
  high: sum(prs.map((p) => p.minutes.high)) / DAY_MINUTES,
});

// 1つの賭けの ROI が出せない理由(出せれば null)
const whyNoRoi = (b, cost) => {
  if (!REACHED.includes(b.stage) || !b.reachedOn) return "rollout の前(得た物はまだ数えない)";
  if (!b.gain) return "「- 得る物の見込み(月):」が無い";
  if (!(cost.low > 0)) return "原価が数えられない(この賭けの PR が無い)";
  return null;
};

/**
 * 賭けごとの原価の累計(人日【推定】)・資産の候補の PR の数・ROI の幅と回収の月数(loop-lib.mjs の roiRange)。
 * 合計は、ROI を出せた賭けだけを足す(得た物の累計 = 得る物(月)× 経った月数)。土台の PR(賭けの外)は原価だけ別に出す
 */
export function roiTotals(bets, prs, today) {
  const rows = bets.map((b) => {
    const mine = prs.filter((p) => p.bet === b.id);
    const cost = daysOf(mine);
    const row = {
      id: b.id,
      stage: b.stage,
      prs: mine.length,
      assets: mine.filter((p) => p.proposal === "資産の候補").length,
      cost,
    };
    const why = whyNoRoi(b, cost);
    if (why) return { ...row, why };
    const months = Math.max(0, daysBetween(b.reachedOn, today)) / MONTH_DAYS;
    return { ...row, months, gain: b.gain, ...roiRange({ cost, gainMonthly: b.gain, months }) };
  });
  const done = rows.filter((r) => !r.why);
  const total =
    done.length === 0
      ? null
      : roiRange({
          cost: { low: sum(done.map((r) => r.cost.low)), high: sum(done.map((r) => r.cost.high)) },
          gainMonthly: {
            low: sum(done.map((r) => r.gain.low * r.months)),
            high: sum(done.map((r) => r.gain.high * r.months)),
          },
          months: 1,
        });
  return { rows, total, core: daysOf(prs.filter((p) => !p.bet)) };
}

// ── 3. 北極星(届いて使われた数 ÷ 人の工数)の週ごとの分母と分子 ────────────────

/** 数え終わった週(今週は入れない)の月曜を、古い順に n 個 */
export const fullWeeks = (today, n) => {
  const last = mondayOf(addDays(today, -7));
  return Array.from({ length: n }, (_, i) => addDays(last, -7 * (n - 1 - i)));
};

/**
 * 賭けが「届いて使われた」日: rollout に入った後、動かす KPI に最初に記録(records)が付いた日。
 * どちらかが無ければ入れない
 */
export function usedOn(bet, records) {
  if (!REACHED.includes(bet.stage) || !bet.reachedOn) return undefined;
  return (records ?? [])
    .filter((r) => bet.kpis.includes(r.kpi))
    .map((r) => toDate(r.date))
    .filter((d) => d >= bet.reachedOn)
    .sort()[0];
}

/**
 * 週ごとの 分子(その週に届いて使われた賭けの数【実測】)と 分母(その週にマージした PR の人の時間【推定】の幅)。
 * 最後に、n 週の合計と、分子 ÷ 分母(10時間あたり)を付ける
 */
export function northStarWeeks({ bets, prs, records, today, weeks }) {
  const used = bets.map((b) => usedOn(b, records)).filter(Boolean);
  const rows = fullWeeks(today, weeks).map((monday) => {
    const mine = prs.filter((p) => p.week === monday);
    return {
      monday,
      used: used.filter((d) => mondayOf(d) === monday).length,
      prs: mine.length,
      hours: {
        low: round1(sum(mine.map((p) => p.minutes.low)) / 60),
        high: round1(sum(mine.map((p) => p.minutes.high)) / 60),
      },
    };
  });
  const total = {
    used: sum(rows.map((r) => r.used)),
    prs: sum(rows.map((r) => r.prs)),
    hours: {
      low: round1(sum(rows.map((r) => r.hours.low))),
      high: round1(sum(rows.map((r) => r.hours.high))),
    },
  };
  return { rows, total };
}

/** 10時間あたりの分子(悪い方は時間が多い端)。時間が0なら null */
export const perTenHours = (used, hours) =>
  hours.low > 0
    ? { low: round1((used * 10) / hours.high), high: round1((used * 10) / hours.low) }
    : null;

/** どこから PR を読むか: 賭けの最初の小石の日と、週の窓の始まりの早い方 */
export function sinceOf(betFiles, today, weeks) {
  const firsts = betFiles
    .map(({ bet }) => bet.pebbles?.rows?.[0]?.cells[0])
    .filter((d) => typeof d === "string" && d.length === 10);
  return [...firsts, fullWeeks(today, weeks)[0]].sort()[0];
}

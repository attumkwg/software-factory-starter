// 意義の判断役(.claude/agents/purpose-judge.md)の記録の確かめと、当たり外れ(中身だけ)。
// 記録は docs/product/verdicts/*.md(作るプロダクト)と docs/kit/verdicts/*.md(キット自身)。読み書きは kpi.mjs。
// Semgrep の regex_dos に当たる所(意義・KPI の確かめ)は、正規表現を使わずに読む。
// 歯止めの3つ(仕様 0084): ① やらない線(誰の・どんな困りごとが・どれだけ減るかを数で言えなければ「やらない」)
// ② ROI の根拠(費用と得る物の幅から loop-lib.mjs の式で出す。手で上げない)③ 当たり外れ(期限の後に実測と比べ、人が判定する)
import { roiRange } from "./loop-lib.mjs";

export const VERDICTS = ["やる", "やらない", "条件つき"];
export const SCENES = ["アイデア", "分解の前", "受け入れ", "キット"];
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ""));

const field = (lines, name) => {
  const head = `- ${name}:`;
  return lines
    .find((l) => l.startsWith(head))
    ?.slice(head.length)
    .trim();
};

/** 「3〜6」「1.5〜2」の幅。読めなければ undefined */
export function rangeOf(text) {
  const m = String(text ?? "").match(/(-?\d+(?:\.\d+)?)\s*〜\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return undefined;
  const [low, high] = [Number(m[1]), Number(m[2])];
  return low <= high ? { low, high } : undefined;
}

/** 記録を読む。{ date, scene, verdict, purpose, kpi, forecast, by, cost, gain, months, roi, stop, question, actual, judged } */
export function parseVerdict(md) {
  const lines = String(md ?? "")
    .split("\n")
    .map((l) => l.trim());
  const forecastText = field(lines, "見込み") ?? "";
  return {
    date: field(lines, "日付"),
    scene: field(lines, "場面"),
    verdict: field(lines, "判断"),
    purpose: field(lines, "意義") ?? "",
    kpi: field(lines, "動かす KPI") ?? "",
    forecast: rangeOf(forecastText),
    by: forecastText.match(/(\d{4}-\d{2}-\d{2})/)?.[1],
    cost: rangeOf(field(lines, "費用の見込み")),
    gain: rangeOf(field(lines, "得る物の見込み(月)")),
    months: Number(field(lines, "測る月数")),
    roi: field(lines, "ROI の見込み") ?? "",
    stop: field(lines, "止める線") ?? "",
    question: field(lines, "人に聞く問い") ?? "",
    actual: field(lines, "実測"),
    judged: field(lines, "人の判定") ?? "未定",
  };
}

const fixed = (n) => (Number.isFinite(n) ? n.toFixed(1) : "回収しない");

/** ROI の見込みの文(費用・得る物(月)・測る月数から。倍率と月数だけ。金額は書かない) */
export function roiText({ cost, gain, months }) {
  const r = roiRange({ cost, gainMonthly: gain, months });
  return `${fixed(r.roiLow)}〜${fixed(r.roiHigh)} 倍・回収 ${fixed(r.paybackLow)}〜${fixed(r.paybackHigh)} か月`;
}

// 問いが2つ以上に見えるか(「?」が2つ以上・「/」で並べた)
const manyQuestions = (q) => (q.match(/[?？]/g) ?? []).length > 1 || / \/ /.test(q);

// やる・条件つきのときに要る物(歯止め ① と ②)
function goProblems(v, kpiIds) {
  const out = [];
  if (![...v.purpose].some((c) => c >= "0" && c <= "9"))
    out.push(
      "意義に数が無い(誰の・どんな困りごとが・どれだけ減るかを数で言えなければ「やらない」)",
    );
  if (!v.kpi) out.push("「- 動かす KPI:」が無い");
  else if (v.kpi.startsWith("K-") && kpiIds && !kpiIds.has(v.kpi))
    out.push(`動かす KPI ${v.kpi} が kpi.yaml に無い`);
  if (!v.forecast || !isDate(v.by))
    out.push("「- 見込み:」は「40〜60(YYYY-MM-DD まで)」の形(当たり外れを比べる)");
  if (!v.cost || !v.gain || !(v.months > 0))
    out.push("ROI の根拠が無い(費用の見込み・得る物の見込み(月)・測る月数を幅で)");
  else if (v.roi !== roiText(v))
    out.push(`ROI の見込みは「${roiText(v)}」(費用と得る物から出した値。手で上げない)`);
  if (!v.stop) out.push("「- 止める線:」が無い");
  return out;
}

/** 記録の誤り(空なら良い)。kpiIds は kpi.yaml の番号(K- で始まる KPI だけ確かめる) */
export function verdictProblems(md, kpiIds) {
  const v = parseVerdict(md);
  const out = [];
  if (!isDate(v.date)) out.push("「- 日付:」は YYYY-MM-DD");
  if (!SCENES.includes(v.scene)) out.push(`「- 場面:」は ${SCENES.join(" / ")} のどれか`);
  if (!VERDICTS.includes(v.verdict)) out.push(`「- 判断:」は ${VERDICTS.join(" / ")} のどれか`);
  if (!v.purpose) out.push("「- 意義:」が無い");
  if (v.verdict === "やる" || v.verdict === "条件つき") out.push(...goProblems(v, kpiIds));
  if (manyQuestions(v.question)) out.push("人に聞く問いは1つまで");
  if (!/^(未定|(正しかった|間違っていた) @)/.test(v.judged))
    out.push("「- 人の判定:」は「未定」か「正しかった @名前 日付」「間違っていた @名前 日付」");
  return out;
}

/**
 * やる・条件つきの判断を、期限までの実測と比べる(歯止め ③)。実測は記録の「- 実測:」、無ければ kpi.yaml の records。
 * 当たり = 見込みの幅の中か、良い向きの外 / 外れ = 悪い向きの外 / 測っていない / まだ(期限の前)。
 * direction は KPI の target.direction(above = 多いほど良い・既定 / below = 少ないほど良い)
 */
export function verdictResult(v, records, today, direction = "above") {
  if (!(v.verdict === "やる" || v.verdict === "条件つき") || !v.forecast || !isDate(v.by))
    return "比べない";
  if (v.by > today) return "まだ";
  const hand = Number(String(v.actual ?? "").match(/-?\d+(?:\.\d+)?/)?.[0]);
  const fromRecords = (records ?? [])
    .filter((r) => r.kpi === v.kpi && r.date <= v.by && typeof r.value === "number")
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1)?.value;
  const actual = Number.isFinite(hand) ? hand : fromRecords;
  if (actual === undefined) return "測っていない";
  const good = direction === "below" ? actual <= v.forecast.high : actual >= v.forecast.low;
  return good ? "当たり" : "外れ";
}

/**
 * 判断役の当たり率と、人の判定を待つ記録。items は { path, v, result }。
 * 外れが半分を超えたら(2件以上確かめて)、判断役の物差しを見直す合図
 */
export function verdictSummary(items) {
  const checked = items.filter((i) => i.result === "当たり" || i.result === "外れ");
  const hits = checked.filter((i) => i.result === "当たり").length;
  const waiting = items
    .filter((i) => i.result !== "まだ" && i.result !== "比べない" && i.v.judged === "未定")
    .map(
      (i) =>
        `${i.path}: 期限を過ぎた(${i.result})。判断が正しかったかを人が判定する(「- 人の判定:」)`,
    );
  return {
    hits,
    checked: checked.length,
    review: checked.length >= 2 && hits / checked.length < 0.5,
    waiting,
  };
}

// KPI の木の一覧と書き方の確かめ: docs/product/kpi.yaml と docs/product/personas.md を読む。
//   pnpm kpi   北極星・入力・守りの指標ごとに、最新の値と線(届いた・まだ・期限を過ぎた・守れている・超えた)を出す。
//              書き方が違う(形・番号・ペルソナ・測り方・金額をリポジトリに書いた)ときは 1 で終わる(CI)。
//              まだ kpi.yaml が無ければ、何もせずに通す(/kickoff で作る)。
//              ペルソナの書き方と、合議の記録(docs/product/councils/)の形も見る。合議は任意の参考で、7つの立場の
//              そろいは知らせるだけ(既定は反論役1人の軽い形。仕様 0084)。
//              「確か」の指標は、どの合議か意義の判断から来たか(council)が要る(仮説の指標は知らせるだけ)。
//              意義の判断役の記録(docs/product/verdicts/・docs/kit/verdicts/)の形・歯止め(数で言えない意義・ROI の根拠)と、
//              期限の後の当たり外れ・判断役の当たり率・人の判定を待つ記録を出す(verdict-lib.mjs)。
//              ループを閉じる: 記録が古い・無い指標、記録の無い rollout 以降の賭けを知らせ、合議の見込み(forecasts)と
//              実測を比べて合議ごとの当たり率を出す。合議の星(価値・確からしさ)は表から出した値と合っているかを見る。
// 決まりは docs/guides/kpi.md・仕様 0081・0082・0083・0084(立場の地図と合議は council-lib.mjs、ループは loop-lib.mjs)。
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { idOfFile, parseBet } from "./bets-lib.mjs";
import { todayInTokyo } from "./checkup/phase.mjs";
import {
  councilLinkNotes,
  councilNotes,
  councilProblems,
  councilRows,
  councilStars,
  parsePersonas,
  personaProblems,
  stanceNotes,
} from "./council-lib.mjs";
import { allKpis, checkKpi, featureNamesOf, kpiRefs, kpiReport, personaIdsOf } from "./kpi-lib.mjs";
import {
  councilHitRates,
  evidenceStars,
  forecastProblems,
  forecastResults,
  staleNotes,
  unmeasuredBetNotes,
  valueStars,
} from "./loop-lib.mjs";
import { parseVerdict, verdictProblems, verdictResult, verdictSummary } from "./verdict-lib.mjs";

const KPI = "docs/product/kpi.yaml";
const COUNCILS = "docs/product/councils";
const BETS = "docs/product/bets";
const PERSONAS = "docs/product/personas.md";
const VERDICTS = ["docs/product/verdicts", "docs/kit/verdicts"];
const FLAGS = "packages/shared/src/feature-flags.ts";
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const listMd = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
        .map((f) => join(dir, f).replaceAll("\\", "/"))
    : [];

const verdictFiles = VERDICTS.flatMap(listMd);

// 意義の判断役の記録(歯止めの3つ。kpi.yaml が無くても、キット自身の記録は見る)
function checkVerdicts(doc, today) {
  const kpis = allKpis(doc ?? {});
  const kpiIds = doc ? new Set(kpis.map((k) => k.id)) : undefined;
  const direction = new Map(kpis.map((k) => [k.id, k.target?.direction ?? "above"]));
  const problems = [];
  const items = verdictFiles.map((path) => {
    const md = read(path);
    problems.push(...verdictProblems(md, kpiIds).map((p) => `${path} ${p}`));
    const v = parseVerdict(md);
    return { path, v, result: verdictResult(v, doc?.records, today, direction.get(v.kpi)) };
  });
  const lines = items.map((i) => `  ${i.path}: ${i.v.verdict}・${i.result}`);
  const s = verdictSummary(items);
  if (s.checked > 0)
    lines.push(
      `  当たり ${s.hits}/${s.checked}${s.review ? " → 外れが多い。判断役の物差し(やらない線・ROI の根拠)を見直す" : ""}`,
    );
  return { problems, lines, waiting: s.waiting };
}

const today = todayInTokyo();

if (!existsSync(KPI)) {
  console.log(`${KPI} はまだ無い(/kickoff で、ペルソナと一緒に作る。docs/guides/kpi.md)`);
  const verdicts = checkVerdicts(undefined, today);
  if (verdicts.lines.length > 0) console.log(`\n意義の判断:\n${verdicts.lines.join("\n")}`);
  for (const w of verdicts.waiting) console.log(`ℹ ${w}`);
  if (verdicts.problems.length > 0) {
    console.log(`\n⚠️ 書き方の問題: ${verdicts.problems.length}件`);
    for (const p of verdicts.problems) console.log(`- ${p}`);
    process.exit(1);
  }
  process.exit(0);
}
const doc = parse(read(KPI));
const { problems, warnings } = checkKpi(doc, {
  personas: personaIdsOf(read(PERSONAS)),
  features: featureNamesOf(read(FLAGS)),
});

// 立場の地図
const personas = parsePersonas(read(PERSONAS));
problems.push(...personaProblems(personas).map((p) => `personas.md ${p}`));
warnings.push(...stanceNotes(personas).map((n) => `personas.md ${n}(全員の合議を回すときに足す)`));

// 合議の記録・星・指標がどの合議から来たか
const councilFiles = listMd(COUNCILS);
const stanceOf = new Map(personas.map((p) => [p.id, p.stance]));
const starLines = [];
for (const f of councilFiles) {
  const md = read(f);
  problems.push(...councilProblems(md, stanceOf).map((p) => `${f} ${p}`));
  warnings.push(...councilNotes(md, stanceOf).map((n) => `${f} ${n}`));
  const rows = councilRows(md);
  const recorded = councilStars(md);
  const machine = { 価値: valueStars(rows), 確からしさ: evidenceStars(rows) };
  for (const [axis, star] of Object.entries(machine))
    if (recorded.has(axis) && recorded.get(axis) !== star)
      problems.push(`${f} 8 の ${axis} は ★${star}(1 の表から出した値。手で上げない)`);
  if (recorded.size > 0)
    starLines.push(`${f}: ${[...recorded].map(([a, s]) => `${a} ★${s}`).join("・")}`);
}
const sure = new Set(
  allKpis(doc)
    .filter((k) => k.kind !== "watch" && k.status === "確か")
    .map((k) => k.id),
);
for (const note of councilLinkNotes(doc, new Set([...councilFiles, ...verdictFiles]))) {
  if (sure.has(note.split(":")[0]))
    problems.push(`kpi.yaml ${note}(「確か」の指標は合議か意義の判断から)`);
  else warnings.push(note);
}

// 合議の見込み(forecasts)
const kpiIds = new Set(allKpis(doc).map((k) => k.id));
problems.push(...forecastProblems(doc.forecasts, kpiIds).map((p) => `kpi.yaml ${p}`));

const report = kpiReport(doc, today);
const verdicts = checkVerdicts(doc, today);
problems.push(...verdicts.problems);
warnings.push(...verdicts.waiting);

// 計測が止まっていないか(記録の古さ・rollout 以降の賭けの記録)
const recordedIds = new Set((doc.records ?? []).map((r) => r.kpi));
const bets = listMd(BETS).map((path) => {
  const bet = parseBet(read(path));
  return { id: idOfFile(path.split("/").pop()), stage: bet.stage, kpis: kpiRefs(bet.kpi) };
});
warnings.push(...staleNotes(report, today), ...unmeasuredBetNotes(bets, recordedIds));

const KIND = { north_star: "★ 北極星", input: "→ 入力", guardrail: "🛡 守り", watch: "・ 見るだけ" };
console.log(`KPI の木を読みました(${KPI})`);
if (problems.length === 0) {
  for (const r of report) {
    const value = r.last ? (r.last.value ?? (r.last.reached ? "線の内" : "線の外")) : "—";
    const at = r.last ? `(${r.last.date})` : "";
    console.log(
      `${KIND[r.kind]} ${r.id} ${r.name}: ${value}${r.last?.value !== undefined ? ` ${r.unit ?? ""}` : ""}${at} … ${r.judge}`,
    );
  }
  const results = forecastResults(doc, today);
  if (results.length > 0) {
    console.log("\n合議の見込みと実測:");
    for (const r of results)
      console.log(
        `  ${r.kpi} ${r.low}〜${r.high}(${r.by} まで): ${r.result}${r.actual !== undefined ? `(実測 ${r.actual})` : ""}`,
      );
    for (const c of councilHitRates(results))
      console.log(
        `  ${c.council}: 当たり ${c.hits}/${c.checked}${c.redo ? " → 外れが多い。ペルソナと業界の前提を見直して、合議を回し直す(/council)" : ""}`,
      );
  }
  if (starLines.length > 0) console.log(`\n合議の星:\n  ${starLines.join("\n  ")}`);
  if (verdicts.lines.length > 0) console.log(`\n意義の判断:\n${verdicts.lines.join("\n")}`);
}
for (const w of warnings) console.log(`ℹ ${w}`);
if (problems.length > 0) {
  console.log(`\n⚠️ 書き方の問題: ${problems.length}件(docs/guides/kpi.md)`);
  for (const p of problems) console.log(`- ${p}`);
  process.exit(1);
}

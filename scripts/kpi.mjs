// KPI の木の一覧と書き方の確かめ: docs/product/kpi.yaml と docs/product/personas.md を読む。
//   pnpm kpi   北極星・入力・守りの指標ごとに、最新の値と線(届いた・まだ・期限を過ぎた・守れている・超えた)を出す。
//              書き方が違う(形・番号・ペルソナ・測り方・金額をリポジトリに書いた)ときは 1 で終わる(CI)。
//              まだ kpi.yaml が無ければ、何もせずに通す(/kickoff で作る)。
//              ペルソナの立場の地図(7つの立場がそろうか)と、合議の記録(docs/product/councils/)の形も見る。
//              「確か」の指標は、どの合議から来たか(council)が要る(仮説の指標は知らせるだけ)。
// 決まりは docs/guides/kpi.md・仕様 0081・0082(立場の地図と合議は council-lib.mjs)。賭けとのつなぎは pnpm bets が見る。
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import {
  councilLinkNotes,
  councilProblems,
  parsePersonas,
  personaProblems,
} from "./council-lib.mjs";
import { checkKpi, featureNamesOf, kpiReport, personaIdsOf } from "./kpi-lib.mjs";

const KPI = "docs/product/kpi.yaml";
const COUNCILS = "docs/product/councils";
const PERSONAS = "docs/product/personas.md";
const FLAGS = "packages/shared/src/feature-flags.ts";
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

if (!existsSync(KPI)) {
  console.log(`${KPI} はまだ無い(/kickoff で、ペルソナと一緒に作る。docs/guides/kpi.md)`);
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

// 合議の記録と、指標がどの合議から来たか
const councilFiles = existsSync(COUNCILS)
  ? readdirSync(COUNCILS)
      .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
      .map((f) => `${COUNCILS}/${f}`)
  : [];
const stanceOf = new Map(personas.map((p) => [p.id, p.stance]));
for (const f of councilFiles)
  problems.push(...councilProblems(read(f), stanceOf).map((p) => `${f} ${p}`));
const sure = new Set(
  [doc.north_star, ...(doc.inputs ?? []), ...(doc.guardrails ?? [])]
    .filter((k) => k?.status === "確か")
    .map((k) => k.id),
);
for (const note of councilLinkNotes(doc, new Set(councilFiles))) {
  if (sure.has(note.split(":")[0])) problems.push(`kpi.yaml ${note}(「確か」の指標は合議から)`);
  else warnings.push(note);
}

const today = new Date().toISOString().slice(0, 10);
const KIND = { north_star: "★ 北極星", input: "→ 入力", guardrail: "🛡 守り" };
console.log(`KPI の木を読みました(${KPI})`);
if (problems.length === 0) {
  for (const r of kpiReport(doc, today)) {
    const value = r.last ? (r.last.value ?? (r.last.reached ? "線の内" : "線の外")) : "—";
    const at = r.last ? `(${r.last.date})` : "";
    console.log(
      `${KIND[r.kind]} ${r.id} ${r.name}: ${value}${r.last?.value !== undefined ? ` ${r.unit ?? ""}` : ""}${at} … ${r.judge}`,
    );
  }
}
for (const w of warnings) console.log(`ℹ ${w}`);
if (problems.length > 0) {
  console.log(`\n⚠️ 書き方の問題: ${problems.length}件(docs/guides/kpi.md)`);
  for (const p of problems) console.log(`- ${p}`);
  process.exit(1);
}

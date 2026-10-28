// KPI の木の一覧と書き方の確かめ: docs/product/kpi.yaml と docs/product/personas.md を読む。
//   pnpm kpi   北極星・入力・守りの指標ごとに、最新の値と線(届いた・まだ・期限を過ぎた・守れている・超えた)を出す。
//              書き方が違う(形・番号・ペルソナ・測り方・金額をリポジトリに書いた)ときは 1 で終わる(CI)。
//              まだ kpi.yaml が無ければ、何もせずに通す(/kickoff で作る)。
// 決まりは docs/guides/kpi.md・仕様 0081。賭けとのつなぎは pnpm bets が見る。
import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import { checkKpi, featureNamesOf, kpiReport, personaIdsOf } from "./kpi-lib.mjs";

const KPI = "docs/product/kpi.yaml";
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

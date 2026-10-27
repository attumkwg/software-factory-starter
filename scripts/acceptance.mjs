// 受け入れの記録の点数と、書き方の問題(CI は acceptance.test.mjs の「今の記録」で同じ物を見る)。
//   pnpm acceptance   docs/acceptance/NNNN-*.md の回ごとの点数(PdM・AI と QA・全体)と外れた理由の内訳を出す。
//                     書き方の問題があれば 1 で終わる。中身は acceptance-lib.mjs、書き方は docs/guides/acceptance.md
import { percent, REASONS, readRepoAcceptance, scoreOf } from "./acceptance-lib.mjs";

const { rounds, problems } = readRepoAcceptance();
if (rounds.length === 0)
  console.log("受け入れの記録はまだありません(docs/acceptance/。/accept が書く)");
else {
  console.log(
    `| 記録 | 回 | 日付 | PdM | AI・QA | 全体 | 項目(うち PdM) | ${REASONS.join(" | ")} |`,
  );
  console.log(`|---|---|---|---|---|---|---|${REASONS.map(() => "---|").join("")}`);
  for (const r of rounds) {
    const s = scoreOf(r);
    const reasons = REASONS.map((k) => s.reasons[k]).join(" | ");
    console.log(
      `| ${r.path} | ${r.no} | ${r.date} | ${percent(s.pdm)} | ${percent(s.sweep)} | ${percent(s.all)} | ${s.items}(${s.pdmItems}) | ${reasons} |`,
    );
  }
}
if (problems.length > 0) {
  console.log(`\n❌ 書き方の問題: ${problems.length}件(docs/guides/acceptance.md)`);
  for (const p of problems) console.log(`- ${p}`);
  process.exit(1);
}

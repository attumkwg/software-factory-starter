// ADR の番号の確かめ: docs/adr/NNNN-*.md を読む。
//   pnpm adr   番号が重なっている・ファイル名と見出しの番号が違う ときは 1 で終わる(CI)
//              仕様(docs/specs)・設計書(docs/designs)も、同じフォルダの中で番号が重なれば 1 で終わる
//              番号が範囲(docs/kit/numbering.yaml)の外でも 1 で終わる。次の番号は自分の範囲の中で出す
//   pnpm adr --own-from 5000   自分の範囲の始まりを決める(先に pnpm checkup:adopt を済ませたリポジトリで一度だけ)
// 並んで進む PR が同じ番号を取ることがある。main に追いついた後の CI で、後からマージする側が落ちる。
import { checkAdrs, checkNumberedDocs, nextInRange } from "./adr-lib.mjs";
import { DIRS, decideOwnFrom, loadNumberedDocs, loadRange, rangeProblems } from "./numbering.mjs";

const args = process.argv.slice(2);
const at = args.indexOf("--own-from");
if (at >= 0) {
  const { ownFrom, problems } = decideOwnFrom(args[at + 1]);
  if (problems.length > 0) {
    console.log(`❌ 自分の範囲を ${ownFrom} からにできない(書かなかった):`);
    for (const p of problems) console.log(`- ${p}`);
    process.exit(1);
  }
  console.log(
    `✅ 自分の記録の番号は ${ownFrom} から(docs/kit/numbering.yaml)。変えたファイルを PR に`,
  );
}

const range = loadRange();
const { adrs, specs, designs } = loadNumberedDocs();
const problems = [
  ...checkAdrs(adrs),
  ...checkNumberedDocs(DIRS.specs, specs),
  ...checkNumberedDocs(DIRS.designs, designs),
  ...rangeProblems(range, { adrs, specs, designs }),
];

const where =
  range.ownFrom === null
    ? `キットの範囲 〜${range.kitUntil}`
    : `自分の範囲 ${range.ownFrom}〜(キットは 〜${range.kitUntil})`;
console.log(`番号の範囲: ${where}`);
console.log(
  `ADR ${adrs.length}件を読みました(${DIRS.adr})。次の番号は ${nextInRange(adrs, range)}`,
);
console.log(
  `仕様 ${specs.length}件・設計書 ${designs.length}件を読みました。仕様と設計書の次の番号は ${nextInRange([...specs, ...designs], range)}`,
);
if (problems.length > 0) {
  console.log(`\n⚠️ 番号の問題: ${problems.length}件`);
  for (const p of problems) console.log(`- ${p}`);
  console.log("\n❌ 直してください(振り直したら、docs・コードのコメント・カタログの参照も直す)。");
  process.exit(1);
}

// ADR の番号の確かめ: docs/adr/NNNN-*.md を読む。
//   pnpm adr   番号が重なっている・ファイル名と見出しの番号が違う ときは 1 で終わる(CI)
//              仕様(docs/specs)・設計書(docs/designs)も、同じフォルダの中で番号が重なれば 1 で終わる
// 並んで進む PR が同じ番号を取ることがある。main に追いついた後の CI で、後からマージする側が落ちる。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkAdrs, checkNumberedDocs, nextDocNumber, nextNumber } from "./adr-lib.mjs";

const DIR = "docs/adr";

const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
  .sort()
  .map((file) => ({
    file,
    firstLine: readFileSync(join(DIR, file), "utf8").split("\n")[0].trim(),
  }));
const problems = checkAdrs(files);

const names = (dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    .sort()
    .map((file) => ({ file }));
const specs = names("docs/specs");
const designs = names("docs/designs");
problems.push(
  ...checkNumberedDocs("docs/specs", specs),
  ...checkNumberedDocs("docs/designs", designs),
);

console.log(`ADR ${files.length}件を読みました(${DIR})。次の番号は ${nextNumber(files)}`);
console.log(
  `仕様 ${specs.length}件・設計書 ${designs.length}件を読みました。仕様と設計書の次の番号は ${nextDocNumber(specs, designs)}`,
);
if (problems.length > 0) {
  console.log(`\n⚠️ 番号の問題: ${problems.length}件`);
  for (const p of problems) console.log(`- ${p}`);
  console.log("\n❌ 直してください(振り直したら、docs・コードのコメント・カタログの参照も直す)。");
  process.exit(1);
}

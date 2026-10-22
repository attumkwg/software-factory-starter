// ADR の番号の確かめ: docs/adr/NNNN-*.md を読む。
//   pnpm adr   番号が重なっている・ファイル名と見出しの番号が違う ときは 1 で終わる(CI)
// 並んで進む PR が同じ番号を取ることがある。main に追いついた後の CI で、後からマージする側が落ちる。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkAdrs, nextNumber } from "./adr-lib.mjs";

const DIR = "docs/adr";

const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
  .sort()
  .map((file) => ({
    file,
    firstLine: readFileSync(join(DIR, file), "utf8").split("\n")[0].trim(),
  }));
const problems = checkAdrs(files);

console.log(`ADR ${files.length}件を読みました(${DIR})。次の番号は ${nextNumber(files)}`);
if (problems.length > 0) {
  console.log(`\n⚠️ 番号の問題: ${problems.length}件`);
  for (const p of problems) console.log(`- ${p}`);
  console.log("\n❌ 直してください(振り直したら、docs・コードのコメント・カタログの参照も直す)。");
  process.exit(1);
}

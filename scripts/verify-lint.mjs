// PR の動作確認の手順の危ない書き方を止める(1層目。/verify-pr が流す前に打つ)。
//   pnpm verify:lint                         apps/web/e2e/verify/*.spec.ts を全部
//   pnpm verify:lint <ファイル> [<ファイル>…]   指定した物
// 問題があれば 1 で終わる。中身は verify-lint-lib.mjs、見る所は docs/guides/verify-pr.md
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { lintVerify } from "./verify-lint-lib.mjs";

const DIR = "apps/web/e2e/verify";
const given = process.argv.slice(2);
const files =
  given.length > 0
    ? given
    : existsSync(DIR)
      ? readdirSync(DIR)
          .filter((f) => f.endsWith(".spec.ts"))
          .map((f) => `${DIR}/${f}`)
      : [];
if (files.length === 0) {
  console.log(`確認の手順がありません(${DIR}/*.spec.ts。/verify-pr が書く)`);
  process.exit(0);
}
let count = 0;
for (const file of files) {
  for (const p of lintVerify(readFileSync(file, "utf8"))) {
    count += 1;
    console.log(`${file}:${p.line} [${p.rule}] ${p.message}`);
  }
}
if (count > 0) {
  console.log(`\n❌ 危ない書き方: ${count}件。直してから流す(docs/guides/verify-pr.md)`);
  process.exit(1);
}
console.log(`✅ ${files.length}本の手順に危ない書き方はありません(通った後は記録を疑って読む)`);

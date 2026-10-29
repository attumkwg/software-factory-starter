// 未確定事項の一覧: 設計書(docs/designs/*.md)の「未確定事項」の表から、
// まだ人が答えていない行(仮決め)・使う人が決める行(導入時に決める)・後で決める行(保留)を集めて出す。
//   pnpm decisions            一覧を出す
//   pnpm decisions --strict   仮決めが残っている・書き方が違う・保留の期限が過ぎた ときは 1 で終わる(マージの前に)。
//                             導入時に決める は落とさない(キットの既定でマージしてよい)
//   pnpm decisions --adopt    導入時に決める だけを設計書ごとに出す(使い始めた人の決めることリスト)
//   pnpm decisions --launch   --strict に加えて、導入時に決める が残っていても 1 で終わる(本番に出す前に)
// 書き方は docs/guides/human-review.md の 2。中身は decisions-lib.mjs。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { todayInTokyo } from "./checkup/phase.mjs";
import { ADOPT, adoptLines, groupRows, readDecisions, verdict } from "./decisions-lib.mjs";

const DIR = "docs/designs";
const strict = process.argv.includes("--strict");
const adopt = process.argv.includes("--adopt");
const launch = process.argv.includes("--launch");
const today = todayInTokyo();

const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
  .sort();
const docs = files.map((file) => {
  const path = join(DIR, file).replaceAll("\\", "/");
  return { path, text: readFileSync(path, "utf8").replaceAll("\r\n", "\n") };
});
const result = readDecisions(docs, today);
const { open, adopt: toAdopt, deferred } = groupRows(result.rows);

const show = (title, rows) => {
  console.log(`\n${title}: ${rows.length}件`);
  for (const r of rows) {
    console.log(`- ${r.id}(${r.stage}・${r.kind})${r.fact}`);
    console.log(`    問い: ${r.question}`);
    console.log(`    状態: ${r.state}  … ${r.where}`);
  }
};

console.log(`設計書 ${files.length}件を読みました(${DIR})`);
if (adopt) {
  console.log("");
  for (const line of adoptLines(result.rows)) console.log(line);
} else {
  show("🟡 仮決め(人がまだ答えていない)", open);
  show(`🧭 ${ADOPT}(キットの既定のまま。使う人が決める。pnpm decisions --adopt)`, toAdopt);
  show("⏸ 保留(後で決める)", deferred);
}
if (result.problems.length > 0) {
  console.log(`\n⚠️ 書き方の問題: ${result.problems.length}件`);
  for (const p of result.problems) console.log(`- ${p}`);
}

const { fail, message } = verdict(result, { strict, launch });
if (message) console.log(`\n${message}`);
if (fail) process.exit(1);

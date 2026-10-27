// 穴の一覧(docs/scenarios/gaps.md)と、それを指す文書が今の姿かを確かめる(CI)。中身は gaps-lib.mjs、テストは gaps.test.mjs。
//   pnpm gaps           次があれば 1 で終わる:
//                       穴の行の番号の重なり・印の形の崩れ / 済みの行が指す仕様が「下書き」のまま /
//                       残っている穴が「🎯」の節のどの段にも無い / 頭の「今の数」の表が古い /
//                       docs(仕様・設計書・ADR を除く)と README.md が、済んだ穴を ❌・「穴 G-xx」・
//                       「G-xx が埋まるまでは」「G-xx を入れるときは」で指している(台本の「足す前の判定」は除く)
//   pnpm gaps --write   頭の「今の数」の表を作り直す(ほかの問題があれば、作り直したうえで 1 で終わる)
// 決まりは docs/designs/0078-gaps-watch.md。
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  checkGaps,
  currentSummary,
  isScenario,
  renderSummary,
  replaceSummary,
  shouldScan,
  staleRefs,
  summarize,
} from "./gaps-lib.mjs";

const GAPS = "docs/scenarios/gaps.md";
const SPECS = "docs/specs";
const write = process.argv.includes("--write");
const read = (p) => readFileSync(p, "utf8").replaceAll("\r\n", "\n");

// 仕様の番号 → 「> 状態:」の中身
const specStates = new Map();
for (const file of readdirSync(SPECS).filter((f) => f.endsWith(".md") && !f.startsWith("_"))) {
  const line = read(`${SPECS}/${file}`)
    .split("\n")
    .find((l) => l.startsWith("> 状態:"));
  specStates.set(file.slice(0, 4), line ? line.slice("> 状態:".length).trim() : "");
}

const text = read(GAPS);
const result = checkGaps(text, specStates);
const summary = summarize(result);
const problems = [...result.problems];

const listed = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
});
if (listed.status !== 0) {
  console.log("git ls-files が失敗した(git のリポジトリの中で動かす)");
  process.exit(1);
}
const done = new Set(result.rows.filter((r) => r.status === "済み").map((r) => r.id));
const files = listed.stdout.split("\0").filter((f) => f !== "" && shouldScan(f));
for (const path of files) {
  let body;
  try {
    body = read(path);
  } catch {
    continue; // 消したがまだ git に残っているファイルなど
  }
  for (const p of staleRefs(body, done, { scenario: isScenario(path) }))
    problems.push(`${path}:${p.line} ${p.message}`);
}

const block = renderSummary(summary);
if (write) {
  writeFileSync(GAPS, replaceSummary(text, block));
  console.log(`${GAPS} の「今の数」の表を作り直しました`);
} else if (currentSummary(text) !== block) {
  problems.push(`${GAPS} の頭の「今の数」の表が古い(pnpm gaps --write で作り直す)`);
}

console.log(`穴 ${result.rows.length}件・文書 ${files.length}件を読みました\n`);
console.log(block);
if (problems.length > 0) {
  console.log(`\n⚠️ 直す所: ${problems.length}件`);
  for (const p of problems) console.log(`- ${p}`);
  console.log(
    "\n❌ 直してください(行の書き方と段は gaps.md の「🎯」の節、決まりは docs/designs/0078-gaps-watch.md)。",
  );
  process.exit(1);
}
console.log("\n✅ 穴の一覧と、それを指す文書は今の姿です");

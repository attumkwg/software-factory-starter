// キットが自分の中で閉じているか(CI)。中身は self-contained-lib.mjs、テストは self-contained.test.mjs。
//   pnpm self-contained   リポジトリの全部のファイルを読み、次があれば 1 で終わる:
//                         キットの外(作者の非公開の資料・非公開の元のリポジトリ)を指している /
//                         「security.md 4.3」のような外の節の番号 / docs/security.md に無い決まりの番号(T-99 など)/
//                         キットに無い外の資料のファイル名(scale.md など)/「本人の選択」「本人の決定」
// 根拠は docs/concepts/(考え方)と docs/security.md(番号つきの決まり)に書き、そこを指す。
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { checkText, definedRuleIds, shouldRead } from "./self-contained-lib.mjs";

const MAX_BYTES = 2_000_000;

const listed = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
});
if (listed.status !== 0) {
  console.log("git ls-files が失敗した(git のリポジトリの中で動かす)");
  process.exit(1);
}
const files = listed.stdout.split("\0").filter((f) => f !== "");
const basenames = new Set(files.map((f) => f.split("/").at(-1)));
const ruleIds = definedRuleIds(readFileSync("docs/security.md", "utf8"));

const problems = [];
let read = 0;
for (const path of files) {
  if (!shouldRead(path)) continue;
  let text;
  try {
    if (statSync(path).size > MAX_BYTES) continue;
    text = readFileSync(path, "utf8");
  } catch {
    continue; // 消したがまだ git に残っているファイルなど
  }
  read += 1;
  for (const p of checkText(text, { ruleIds, basenames }))
    problems.push(`${path}:${p.line} ${p.message}`);
}

console.log(`${read}件のファイルを読みました(docs/security.md の決まりの番号 ${ruleIds.size}個)`);
if (problems.length > 0) {
  console.log(`\n⚠️ キットの外を指している所: ${problems.length}件`);
  for (const p of problems) console.log(`- ${p}`);
  console.log(
    "\n❌ 直してください(考え方は docs/concepts/、決まりは docs/security.md に書いて、そこを指す)。",
  );
  process.exit(1);
}
console.log("✅ キットの中で閉じています");

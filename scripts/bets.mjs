// 賭けの一覧と書き方の確かめ: docs/product/bets/B-NNNN-*.md を読む。
//   pnpm bets              一覧を出す。線より前に結果を書いた・段階を飛ばした・書き方が違う ときは 1 で終わる(CI)
//                          期限を過ぎて決めていない賭けは ⏰ で出すだけ(落とさない。毎週の振り返りで見る)
//   pnpm bets --pr-body [--author <名前>]
//                          PR の本文(標準入力)の「取り組み」「作業の種類」を確かめる(CI)
//                          手元で: gh pr view <番号> --json body -q .body | pnpm bets --pr-body
// 決まりは docs/guides/bets-and-assets.md。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkBet, checkPrBody, idOfFile, parseBet } from "./bets-lib.mjs";

const DIR = "docs/product/bets";
const today = new Date().toISOString().slice(0, 10);

const readBets = () => {
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    .sort();
  return files.map((file) => {
    const path = join(DIR, file);
    const bet = parseBet(readFileSync(path, "utf8"));
    const id = idOfFile(file);
    return { file, path, id, bet };
  });
};

const checkAll = (bets) => {
  const problems = [];
  const ids = new Set();
  const rows = [];
  for (const { file, path, id, bet } of bets) {
    if (!id) {
      problems.push(`${path} ファイル名は B-NNNN-<英語の短い名前>.md`);
      continue;
    }
    if (ids.has(id)) problems.push(`${path} ${id} が重なっている`);
    ids.add(id);
    if (!bet.title.startsWith(`賭け: ${id}`))
      problems.push(`${path} 1行目の見出しは「# 賭け: ${id} …」(ファイル名と合わせる)`);
    const result = checkBet(bet, today);
    for (const p of result.problems) problems.push(`${path} ${p}`);
    rows.push({ file, id, bet, ...result });
  }
  return { problems, rows };
};

const mark = (r) => {
  if (r.problems.length > 0) return "⚠️";
  if (r.due) return "⏰";
  if (r.noLine) return "⏳";
  return "・";
};

const list = () => {
  const { problems, rows } = checkAll(readBets());
  console.log(`賭け ${rows.length}件を読みました(${DIR})`);
  for (const r of rows) {
    console.log(
      `${mark(r)} ${r.id} ${r.bet.stage}  ${r.bet.title.slice(`賭け: ${r.id}`.length).trim()}`,
    );
    if (r.due)
      console.log(
        `    ⏰ 期限(${r.due})を過ぎた。進む・変える(線を引き直す)・やめるを決める(/bet)`,
      );
    if (r.noLine)
      console.log(`    ⏳ ${r.bet.stage} の線と期限がまだ無い。確かめる前に決める(/bet)`);
  }
  if (problems.length > 0) {
    console.log(`\n⚠️ 書き方の問題: ${problems.length}件`);
    for (const p of problems) console.log(`- ${p}`);
    console.log("\n❌ 直してください(docs/guides/bets-and-assets.md)。");
    process.exit(1);
  }
};

const prBody = () => {
  const bets = {};
  for (const { id, bet } of readBets()) if (id) bets[id] = bet.stage;
  const at = process.argv.indexOf("--author");
  const author = at > 0 ? (process.argv[at + 1] ?? "") : "";
  const result = checkPrBody(readFileSync(0, "utf8"), { author, bets });
  for (const n of result.notes) console.log(`ℹ️ ${n}`);
  if (result.problems.length > 0) {
    console.log("❌ PR の本文の「🎯 取り組み」を埋めてください(.github/pull_request_template.md):");
    for (const p of result.problems) console.log(`- ${p}`);
    process.exit(1);
  }
  const where = result.stage ? `(段階 ${result.stage})` : "";
  console.log(`取り組み: ${result.work}${where} / 作業の種類: ${result.kind}`);
  console.log(`会計区分の案: ${result.proposal}(案。確定は人。docs/guides/bets-and-assets.md)`);
};

if (process.argv.includes("--pr-body")) prBody();
else list();

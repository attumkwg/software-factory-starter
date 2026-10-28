// 賭けの一覧と書き方の確かめ: docs/product/bets/B-NNNN-*.md を読む。
//   pnpm bets              一覧を出す。線より前に結果を書いた・段階を飛ばした・書き方が違う ときは 1 で終わる(CI)
//                          期限を過ぎて決めていない賭けは ⏰ で出すだけ(落とさない。毎週の振り返りで見る)
//                          線に届かなくても本人の意思で進んだ賭け(意思で進む)は ⚑ で出す。止める線の期限が来ても止めない
//   pnpm bets --roadmap [--public] [--write]
//                          ロードマップの1枚。社内の版(段階・親・次に決める日)と、--public の社外の版
//                          (約束しない書き方)。--write で docs/product/roadmap.md・roadmap-public.md に書く
//   pnpm bets --pr-body [--author <名前>]
//                          PR の本文(標準入力)の「取り組み」「作業の種類」と、人への問いの数(多くて2つ)を確かめる(CI)
//                          手元で: gh pr view <番号> --json body -q .body | pnpm bets --pr-body
// 決まりは docs/guides/bets-and-assets.md。
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkBet, checkPrBody, idOfFile, parseBet } from "./bets-lib.mjs";
import { renderInternal, renderPublic } from "./bets-roadmap.mjs";
import { prQuestionProblems } from "./human-queue-lib.mjs";
import { betLinkProblems, kpiIdsOf, personaIdsOf } from "./kpi-lib.mjs";

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

// 賭けが指してよいペルソナと KPI(無ければ空。psf からは指すのが必須なので、そのとき落ちる)
const readLinks = () => {
  const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
  return {
    personas: personaIdsOf(read("docs/product/personas.md")),
    kpis: kpiIdsOf(read("docs/product/kpi.yaml")),
  };
};

const checkAll = (bets) => {
  const links = readLinks();
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
    result.problems.push(...betLinkProblems(bet, links));
    for (const p of result.problems) problems.push(`${path} ${p}`);
    rows.push({ file, id, bet, ...result });
  }
  return { problems, rows };
};

const mark = (r) => {
  if (r.problems.length > 0) return "⚠️";
  if (r.due || r.willsDue?.length > 0) return "⏰";
  if (r.wills > 0) return "⚑";
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
    for (const w of r.willsDue ?? [])
      console.log(
        `    ⚑ 意思で進んだ(${w.date} ${w.stage})止める線「${w.stopLine}」の期限(${w.due})を過ぎた。続ける・やめるを決める(/bet)`,
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
  const body = readFileSync(0, "utf8");
  const result = checkPrBody(body, { author, bets });
  for (const n of result.notes) console.log(`ℹ️ ${n}`);
  if (result.problems.length > 0) {
    console.log("❌ PR の本文の「🎯 取り組み」を埋めてください(.github/pull_request_template.md):");
    for (const p of result.problems) console.log(`- ${p}`);
    process.exit(1);
  }
  // 人への問いは端的に(多くて2つ・1問1行。仕様 0085)
  const questions = prQuestionProblems(body);
  for (const n of questions.notes) console.log(`ℹ️ ${n}`);
  if (questions.problems.length > 0) {
    console.log("❌ PR の本文の「🧑‍⚖️ 人に判断してほしい所」を絞ってください:");
    for (const p of questions.problems) console.log(`- ${p}`);
    process.exit(1);
  }
  const where = result.stage ? `(段階 ${result.stage})` : "";
  console.log(`取り組み: ${result.work}${where} / 作業の種類: ${result.kind}`);
  console.log(`会計区分の案: ${result.proposal}(案。確定は人。docs/guides/bets-and-assets.md)`);
};

const roadmap = () => {
  const { problems, rows } = checkAll(readBets());
  if (problems.length > 0) {
    console.log("⚠️ 賭けの書き方に問題があるので、先に pnpm bets で直してください。");
    process.exit(1);
  }
  const isPublic = process.argv.includes("--public");
  const text = (isPublic ? renderPublic : renderInternal)(rows, today).join("\n");
  if (!process.argv.includes("--write")) {
    console.log(text);
    return;
  }
  const out = isPublic ? "docs/product/roadmap-public.md" : "docs/product/roadmap.md";
  writeFileSync(out, text);
  console.log(`${out} を作り直しました`);
};

if (process.argv.includes("--pr-body")) prBody();
else if (process.argv.includes("--roadmap")) roadmap();
else list();

// 点検: 台帳(docs/checkup/todo.yaml)を読み、いまの段階(使い始めた日から)に当たる項目を出し、auto の物は実際に確かめる。
//   pnpm checkup                 結果を Markdown で出す(手元)
//   pnpm checkup --json          結果を JSON で出す(知らせ・ほかの道具が読む)
//   pnpm checkup --write-readme  詳しくない人が読む1枚(docs/checkup/README.md)を台帳から作り直す
//   pnpm checkup --today 2026-11-16  日付を変えて試す(段階の確かめ)
//   pnpm checkup --issue         結果で「今週の点検」の Issue を作る・直す(前の週の Issue は閉じる)。checkup.yml が毎週流す
//   pnpm checkup --urgent        急ぎ(severity: high の fail)を1件ずつ Issue にする・直ったら閉じる。checkup.yml が毎日流す
// GitHub は gh で読む。gh が無い・ログインしていない・権限が無いときは落とさず、その項目を unknown にする。
// 台帳の書き方が違うときは 1 で終わる。確かめの結果では落とさない(知らせで伝える)。設計: docs/designs/0007-checkup.md
import { readFileSync, writeFileSync } from "node:fs";
import { makeContext } from "./context.mjs";
import { resolveRepo } from "./gh.mjs";
import { notify } from "./notify-gh.mjs";
import { isDate, toDate, todayInTokyo } from "./phase.mjs";
import { README, renderReadme } from "./readme.mjs";
import { renderReport } from "./report.mjs";
import { loadChecks, runCheckup, toJson } from "./runner.mjs";
import { FILE, loadLedger, validateLedger } from "./todo.mjs";

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

const ledger = loadLedger(readFileSync(FILE, "utf8"));
const checks = await loadChecks();
const problems = validateLedger(ledger, [...checks.keys()]);
if (problems.length > 0) {
  console.error(`❌ 台帳(${FILE})の書き方の問題: ${problems.length}件`);
  for (const p of problems) console.error(`- ${p}`);
  process.exit(1);
}

if (args.includes("--write-readme")) {
  writeFileSync(README, renderReadme(ledger));
  console.log(`${README} を台帳から作り直しました`);
  process.exit(0);
}

const today = option("--today") ?? todayInTokyo();
if (!isDate(today)) {
  console.error(`--today は YYYY-MM-DD(いま: ${today})`);
  process.exit(1);
}

const repo = resolveRepo();
const ctx = makeContext({ repo, today, ledger });
const run = await runCheckup({
  ledger: { ...ledger, started_on: toDate(ledger.started_on) },
  checks,
  ctx,
  today,
});

if (args.includes("--json")) console.log(JSON.stringify(toJson(run), null, 2));
else console.log(renderReport(run));

const weekly = args.includes("--issue");
const urgent = args.includes("--urgent");
if (weekly || urgent) await notify(run, { repo, owners: ledger.owners, weekly, urgent });

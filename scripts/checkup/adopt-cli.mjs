// 台帳(docs/checkup/todo.yaml)を自分の物にし、1枚(docs/checkup/README.md)も作り直す。キットから作ったリポジトリで一度だけ。
//   pnpm checkup:adopt --by @自分                     担当者と相談先を自分に・使い始めた日を今日に
//   pnpm checkup:adopt --by @自分 --advisor @詳しい人  相談先を別の人に
//   --today YYYY-MM-DD で日付を変える。pnpm setup:github が「人がやること」に出す
//   --numbers-from 5000 で自分の記録(仕様・設計書・ADR)の番号の始まりを変える(既定はキットの範囲の次。docs/kit/numbering.yaml)
// 書くと台帳か番号の範囲が壊れるときは何も書かずに 1 で終わる。中身は adopt.mjs・../numbering.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { decideOwnFrom } from "../numbering.mjs";
import { adoptLedger } from "./adopt.mjs";
import { isDate, todayInTokyo } from "./phase.mjs";
import { README, renderReadme } from "./readme.mjs";
import { loadChecks } from "./runner.mjs";
import { FILE, loadLedger, validateLedger } from "./todo.mjs";

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const stop = (message) => {
  console.error(`❌ ${message}`);
  process.exit(1);
};

const by = option("--by");
if (!by || by.startsWith("--"))
  stop("担当者(--by @名前)が要る。ふつうは自分(gh api user のログイン名)");
const today = option("--today") ?? todayInTokyo();
if (!isDate(today)) stop(`--today は YYYY-MM-DD(いま: ${today})`);

const names = [...(await loadChecks()).keys()];
const { text, reset } = adoptLedger(readFileSync(FILE, "utf8"), {
  by,
  advisor: option("--advisor"),
  today,
});
const after = loadLedger(text);
const problems = validateLedger(after, names);
if (problems.length > 0) stop(`書くと台帳が壊れるので書かなかった: ${problems.join(" / ")}`);
const numbers = decideOwnFrom(option("--numbers-from"));
if (numbers.problems.length > 0)
  stop(
    `番号の範囲を ${numbers.ownFrom} からにできないので書かなかった: ${numbers.problems.join(" / ")}`,
  );
writeFileSync(FILE, text);
writeFileSync(README, renderReadme(after));
console.log(
  `✅ 台帳を ${after.owners.responder} の物にした(使い始めた日 ${today}・${reset}件を「まだ」に)。自分の仕様・設計書・ADR の番号は ${numbers.ownFrom} から。次: 最初の /checkup-refresh・変えたファイルを PR に`,
);

// 答え1つを台帳(docs/checkup/todo.yaml)に書き、1枚(docs/checkup/README.md)も作り直す。/checkup が呼ぶ。
//   pnpm checkup:answer <id> --by @名前 --pick "選択肢の label"     人に聞く項目で選んだ
//   pnpm checkup:answer <id> --by @名前 --unsure                     分からない(おすすめで仮に進め、相談先へ。戻せない問いは進めない)
//   pnpm checkup:answer <id> --by @名前 --snooze 2027-01-10 --note 理由  今はやらない(最長90日)
//   pnpm checkup:answer <id> --by @名前 --did                         人が手でやる項目をやった
//   pnpm checkup:answer <id> --by @名前 --could-not --note 理由        できなかった
//   --today YYYY-MM-DD で日付を変えて試す。--note は選んだ・やったにも添えられる
// 項目に check があれば、選んだ・やったの後にその場で確かめ、fail なら済みにしない。
// 書けないとき(答えられる人でない・選択肢が無い・書いた後の台帳が壊れる)は何も書かずに 1 で終わる。
import { readFileSync, writeFileSync } from "node:fs";
import { decide, describe, writeAnswer } from "./answer.mjs";
import { makeContext } from "./context.mjs";
import { resolveRepo } from "./gh.mjs";
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

const id = args[0];
if (!id || id.startsWith("--"))
  stop("最初に項目の id を書く(例: pnpm checkup:answer acct-mfa --by @me --pick …)");
const kinds = ["--pick", "--unsure", "--snooze", "--did", "--could-not"].filter((k) =>
  args.includes(k),
);
if (kinds.length !== 1)
  stop("答えは --pick / --unsure / --snooze / --did / --could-not のどれか1つ");
const kind = kinds[0].slice(2);
const by = option("--by");
if (!by) stop("答えた人(--by @名前)が要る。/checkup は gh api user のログイン名を渡す");
const today = option("--today") ?? todayInTokyo();
if (!isDate(today)) stop(`--today は YYYY-MM-DD(いま: ${today})`);

const text = readFileSync(FILE, "utf8");
const ledger = loadLedger(text);
const checks = await loadChecks();
const names = [...checks.keys()];
if (validateLedger(ledger, names).length > 0)
  stop(`台帳(${FILE})に書き方の問題がある。先に pnpm checkup で見て直す`);

/** 選んだ・やったの裏を取る(項目に check があるときだけ) */
async function verify(item) {
  if (!item?.check || (kind !== "pick" && kind !== "did")) return undefined;
  const ctx = makeContext({ repo: resolveRepo(), today, ledger });
  try {
    return await checks.get(item.check)(ctx);
  } catch (e) {
    return { result: "unknown", note: String(e?.message ?? e).split("\n")[0] };
  }
}

const item = (ledger.items ?? []).find((i) => i.id === id);
const decision = decide(ledger, {
  id,
  by,
  kind,
  choice: option("--pick"),
  until: option("--snooze"),
  note: option("--note"),
  today,
  checkResult: await verify(item),
});
if (decision.error) stop(decision.error);

const next = writeAnswer(text, id, decision);
const after = loadLedger(next);
const problems = validateLedger(after, names);
if (problems.length > 0) stop(`書くと台帳が壊れるので書かなかった: ${problems.join(" / ")}`);
writeFileSync(FILE, next);
writeFileSync(README, renderReadme(after));
console.log(`✅ ${describe(id, decision)}`);

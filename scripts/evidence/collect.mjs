// 証跡を集める(ISMS・P マークの「決めたとおりに回している」記録)。evidence.yml が毎月流し、消せない S3 に置く。
//   pnpm evidence --out <フォルダ>               全部を集めて、フォルダに1件1ファイルの JSON と目録(manifest.json)を書く
//   pnpm evidence --out <フォルダ> --only github  GitHub だけ(github / aws / repo。カンマで並べる)
//   pnpm evidence --list                          集める物の名前と中身の説明だけを出す
// 置き場には送らない(送るのはワークフロー)。ログには名前と件数だけ(中身は出さない。公開のリポジトリのログに残るため)。
// GitHub は gh(CHECKUP_READ_TOKEN があればそれで読む)・AWS は aws(役割の資格情報)。読めない物は目録に理由つきで残し、ほかを続ける。
// 設計: docs/designs/0019-evidence-soa-and-cost.md・手引き: docs/compliance/README.md
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { makeContext } from "../checkup/context.mjs";
import { resolveRepo } from "../checkup/gh.mjs";
import { todayInTokyo } from "../checkup/phase.mjs";
import { FILE, loadLedger } from "../checkup/todo.mjs";
import { awsCli, collectAll, logLine, makeBundle, monthOf, writeBundle } from "./lib.mjs";
import { pick, SOURCES } from "./sources.mjs";

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

if (args.includes("--list")) {
  for (const s of SOURCES) console.log(`${s.name}\t${s.about}`);
  process.exit(0);
}

const out = option("--out");
if (!out) {
  console.error("--out <フォルダ> が要る(置き場には送らない。送るのは evidence.yml)");
  process.exit(1);
}

const commit = (env = process.env) => {
  if (env.GITHUB_SHA) return env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};

const today = todayInTokyo();
const repo = resolveRepo();
const month = monthOf(today);
// 訓練の結果は、前の月の1日から(毎月1日に流すので、前の月の分がまるごと入る)
const prev = new Date(`${month}-01T00:00:00Z`);
prev.setUTCMonth(prev.getUTCMonth() - 1);
const ctx = {
  ...makeContext({ repo, today, ledger: loadLedger(readFileSync(FILE, "utf8")) }),
  aws: awsCli,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  since: prev.toISOString().slice(0, 10),
};

const entries = await collectAll(pick(option("--only")), ctx);
const files = makeBundle({
  kind: "evidence",
  month,
  collectedAt: new Date().toISOString(),
  repo: repo ?? null,
  commit: commit(),
  entries,
});
writeBundle(out, files);
for (const e of entries) console.log(logLine(e));
const failed = entries.filter((e) => !e.ok).length;
console.log(
  `${month} の証跡: ${entries.length - failed}件を集め、${failed}件は読めなかった → ${out}`,
);

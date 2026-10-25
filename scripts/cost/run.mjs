// 費用を集めて、ページ(静的な HTML の1枚)を作る。cost.yml が毎日(有効にしたら)流し、非公開の S3 に置く。
//   pnpm cost --out <dir> --account stg|prod|dev   そのアカウントの AWS の費用(役割の資格情報で)を <dir>/aws-<環境>.json に
//   pnpm cost --out <dir> --only github,anthropic,saas  AWS の外(Actions の分数・AI の使用の金額・SaaS の月額と見積もり)
//   pnpm cost --render <dir>                       <dir> の JSON から summary.json・index.html・manifest.json を作る
//   pnpm cost --out <dir>                          AWS の外を集めて、そのまま作る(手元で試す)
// 置き場には送らない(送るのはワークフロー)。ログには名前と件数だけ(金額は出さない。公開のリポジトリのログに残るため)。
// 設計: docs/designs/0019-evidence-soa-and-cost.md・手引き: docs/guides/cost-dashboard.md・ADR 0032
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeContext } from "../checkup/context.mjs";
import { resolveRepo } from "../checkup/gh.mjs";
import { todayInTokyo } from "../checkup/phase.mjs";
import {
  awsCli,
  collectAll,
  logLine,
  makeBundle,
  manifestOf,
  monthOf,
  writeBundle,
} from "../evidence/lib.mjs";
import { renderHtml } from "./render.mjs";
import { awsCost } from "./source-aws.mjs";
import { anthropicCost, estimates, githubActions, saas } from "./source-other.mjs";
import { makeSummary } from "./summary.mjs";

const ACCOUNTS = ["stg", "prod", "dev"];
const OTHER = {
  github: [
    { name: "github-actions", about: "今月のワークフローごとの実行と分数", collect: githubActions },
  ],
  anthropic: [
    { name: "anthropic", about: "今月の AI の使用の金額(Anthropic)", collect: anthropicCost },
  ],
  saas: [
    { name: "saas", about: "そのほかの SaaS の月額(docs/cost/saas.yaml)", collect: saas },
    { name: "estimates", about: "見積もり(docs/cost/estimates.yaml)", collect: estimates },
  ],
};
const GENERATED = new Set(["summary.json", "manifest.json"]);

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const today = todayInTokyo();
const meta = (repo) => ({
  kind: "cost",
  month: monthOf(today),
  collected_at: new Date().toISOString(),
  repo,
});

function render(dir) {
  const entries = {};
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json") && !GENERATED.has(f)))
    entries[f.slice(0, -5)] = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const summary = makeSummary(entries, { today, generatedAt: new Date().toISOString() });
  const files = new Map();
  for (const f of readdirSync(dir).filter((f) => !GENERATED.has(f) && f !== "index.html"))
    files.set(f, readFileSync(join(dir, f), "utf8"));
  files.set("summary.json", `${JSON.stringify(summary, null, 2)}\n`);
  files.set("index.html", renderHtml(summary));
  files.set(
    "manifest.json",
    `${JSON.stringify(manifestOf(meta(summary.repo ?? null), files), null, 2)}\n`,
  );
  writeBundle(dir, files);
  console.log(
    `費用のページを作りました(読めなかった物 ${summary.notes.length}件)→ ${join(dir, "index.html")}`,
  );
}

async function collect(dir, env = process.env) {
  const repo = resolveRepo();
  const ctx = {
    ...makeContext({ repo, today }),
    aws: awsCli,
    fetch: (url, init) => fetch(url, init),
    env: { ANTHROPIC_ADMIN_KEY: env.ANTHROPIC_ADMIN_KEY },
  };
  const account = option("--account");
  if (account !== undefined && !ACCOUNTS.includes(account))
    fail(`--account は ${ACCOUNTS.join(" / ")} のどれか(いま: ${account})`);
  const kinds = (option("--only") ?? "github,anthropic,saas").split(",").map((s) => s.trim());
  const sources = account
    ? [
        {
          name: `aws-${account}`,
          about: `AWS(${account})の費用`,
          collect: (c) => awsCost(c, account),
        },
      ]
    : kinds.flatMap((k) => OTHER[k] ?? fail(`--only は ${Object.keys(OTHER).join(",")} から`));
  const entries = await collectAll(sources, ctx);
  const m = meta(repo ?? null);
  const files = makeBundle({
    kind: m.kind,
    month: m.month,
    collectedAt: m.collected_at,
    repo: m.repo,
    commit: null,
    entries,
  });
  files.delete("manifest.json"); // 目録は最後に --render がまとめて作る
  writeBundle(dir, files);
  for (const e of entries) console.log(logLine(e));
  return account === undefined && option("--only") === undefined;
}

const renderDir = option("--render");
if (renderDir) {
  if (!existsSync(renderDir)) fail(`${renderDir} が無い`);
  render(renderDir);
} else {
  const out = option("--out") ?? fail("--out <フォルダ> か --render <フォルダ> が要る");
  if (await collect(out)) render(out);
}

// 持ち主が会話(Slack・チャット)で「マージして」と返した PR を、必須のチェックが全部緑になってから AI がマージする
// (仕様 0080・ADR 0082)。1人の間・クラウドの環境で持ち主が KIT_AI_MERGE=slack を入れたときだけ動く。
//   使い方: node scripts/pr-merge-when-green.mjs <PR の番号> --reply "<持ち主の返事をそのまま>"
// 読み書きは gh api(REST)だけ(クラウドの GitHub の中継は GraphQL を通さない)。
// 必須のチェックは、main のルールセット(GitHub)と .github/setup.yml の required_checks の両方を合わせた物。
// どれかが落ちたら・45分で緑にならなければ、マージせずに 1 で終わる(直すのは AI・2回まで。CLAUDE.md)。
// 危険度「高」・テストを弱めた印・守りの場所(CI・フック・設定など)に触る PR は、AI はマージしない(人が GitHub で押す)。
// 課金・個人データなどのセンサーに触ったときは、その領域の問い(docs/concepts/risk-areas.md)も返す。
// 印は CI の途中で付くことがあるので、待つ前と、マージの直前の2回見る。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { soloFrom } from "./decisions-lib.mjs";
import { checkState, humanOnlyReasons, prProblems, requiredChecksFrom } from "./pr-merge-lib.mjs";
import { parseRiskAreas, touchedAreas } from "./risk-areas-lib.mjs";

const fail = (message) => {
  process.stderr.write(`❌ ${message}\n`);
  process.exit(1);
};

if (process.env.KIT_AI_MERGE !== "slack") {
  fail(
    "AI のマージは、持ち主がクラウドの環境に KIT_AI_MERGE=slack を入れたときだけ(手元では人がマージする。docs/guides/slack-requests.md)",
  );
}
const number = Number(process.argv[2]);
const replyAt = process.argv.indexOf("--reply");
const reply = replyAt > 0 ? (process.argv[replyAt + 1] ?? "").trim() : "";
if (!Number.isInteger(number) || number <= 0 || !reply) {
  fail('node scripts/pr-merge-when-green.mjs <PR の番号> --reply "<持ち主の返事>"');
}

const setup = readFileSync(".github/setup.yml", "utf8");
if (!soloFrom(setup)) {
  fail("人が増えた(承認数が 1 以上)ので、AI はマージしない。レビューの後に人がマージする");
}

const gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const api = (path) => JSON.parse(gh(["api", path]));
const repo =
  process.env.GH_REPO ??
  gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();

const pr = api(`repos/${repo}/pulls/${number}`);
const bad = prProblems(pr);
if (bad.length > 0) fail(bad.join("・"));

// AI がマージしてはいけない PR か(印と、変えたファイル)
const protectedPaths = JSON.parse(readFileSync(".claude/hooks/protected-paths.json", "utf8")).paths;
const areas = parseRiskAreas(readFileSync("docs/concepts/risk-areas.md", "utf8"));
const files = JSON.parse(
  gh(["api", "--paginate", "--slurp", `repos/${repo}/pulls/${number}/files?per_page=100`]),
)
  .flat()
  .map((f) => f.filename);
const humanOnly = () => {
  const labels = api(`repos/${repo}/issues/${number}/labels`).map((l) => l.name);
  const reasons = humanOnlyReasons({ labels, files, protectedPaths });
  // 触った「高」の領域の問い(コードを読ませずに、1行で答えてもらう。ADR 0083)
  const questions = touchedAreas(files, areas).map((a) => `${a.name}: ${a.question}`);
  const ask = questions.length > 0 ? `。人に聞く問い: ${questions.join(" / ")}` : "";
  if (reasons.length > 0)
    fail(
      `この PR は AI ではマージしない。人が GitHub でマージする(${reasons.join("・")})${ask}。返事のスレッドにそう伝える`,
    );
};
humanOnly();

const live = api(`repos/${repo}/rules/branches/main`)
  .filter((r) => r.type === "required_status_checks")
  .flatMap((r) => r.parameters.required_status_checks.map((c) => c.context));
const required = [...new Set([...live, ...requiredChecksFrom(setup)])];

const deadline = Date.now() + 45 * 60 * 1000;
for (;;) {
  const runs = api(`repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`).check_runs;
  const state = checkState(required, runs);
  if (state.failed.length > 0) fail(`落ちた必須のチェック: ${state.failed.join("・")}`);
  if (state.green) break;
  if (Date.now() > deadline) fail(`45分たっても終わらない: ${state.pending.join("・")}`);
  process.stdout.write(`待っている: ${state.pending.join("・")}\n`);
  await new Promise((r) => setTimeout(r, 30_000));
}

humanOnly(); // 待つ間に付いた印(危険度「高」・テストを弱めた)も見る

// 待つ間に push があれば、その版のチェックを見ていないので止める(sha を渡すと GitHub が断る)
const merged = JSON.parse(
  gh([
    "api",
    "-X",
    "PUT",
    `repos/${repo}/pulls/${number}/merge`,
    "-f",
    "merge_method=squash",
    "-f",
    `sha=${pr.head.sha}`,
    "-f",
    `commit_title=${pr.title} (#${number})`,
    "-f",
    `commit_message=持ち主の返事でマージ(AI。仕様 0080): ${reply}`,
  ]),
);
if (!merged.merged) fail(`マージできなかった: ${merged.message ?? "理由は不明"}`);
process.stdout.write(`✅ #${number} をマージした(${merged.sha})\n`);

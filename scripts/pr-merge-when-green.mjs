// 持ち主が会話(Slack・チャット)で「マージして」と返した PR を、必須のチェックが全部緑になってから AI がマージする
// (仕様 0080・0085・ADR 0082・0085)。1人の間・持ち主が環境に KIT_AI_MERGE=slack を入れたときだけ動く。
//   使い方: node scripts/pr-merge-when-green.mjs <PR の番号> --reply "<持ち主の返事をそのまま>" --answered-at <返した日時> [--where Slack|チャット]
// 読み書きは gh api(REST)だけ(クラウドの GitHub の中継は GraphQL を通さない)。
// 必須のチェックは、main のルールセット(GitHub)と .github/setup.yml の required_checks の両方を合わせた物。
// どれかが落ちたら・45分で緑にならなければ、マージせずに 1 で終わる(直すのは AI・2回まで。CLAUDE.md)。
// 危険度「高」・テストを弱めた印・守りの場所(CI・フック・設定など)に触る PR も、1人の間は会話の答えでマージする(ADR 0085)。
// そのときは、人の答えが要った理由と、触った「高」の領域の問い(docs/concepts/risk-areas.md)も記録に書く。
// マージの前に、持ち主の言葉・答えた日時・当てた版を PR にコメントで残す(「## 持ち主の承認(会話で…」。判断待ちの積み場はこれで答え済みと見る)。
//
// センサーだけで入れる(G-135・ADR 0094): node scripts/pr-merge-when-green.mjs <PR の番号> --sensors
//   持ち主が .github/setup.yml の ai_merge.sensors_only を true にした所だけ。人を呼ぶ理由(守る場所・「高」の領域・印・問い・
//   本文の危険度「高」)が1つでもあれば、返事を待つ(1 で終わる)。緑になった後にもう一度見る(待つ間に付いた印・直した本文)。
// main にマージキューがあれば、マージせずにキューに並べる(GraphQL の enqueuePullRequest。キューの中で必須のチェックをもう一度流す)。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { soloFrom } from "./decisions-lib.mjs";
import { answerComment, answeredAtOf, hasAnswer, prQuestions } from "./human-queue-lib.mjs";
import {
  checkState,
  humanOnlyReasons,
  mergeQueueOn,
  prProblems,
  requiredChecksFrom,
  SENSOR_MARK,
  sensorComment,
  sensorMergeBlockers,
  sensorsOnlyFrom,
} from "./pr-merge-lib.mjs";
import { parseRiskAreas, touchedAreas } from "./risk-areas-lib.mjs";

const fail = (message) => {
  process.stderr.write(`❌ ${message}\n`);
  process.exit(1);
};

if (process.env.KIT_AI_MERGE !== "slack") {
  fail(
    "AI のマージは、持ち主が環境に KIT_AI_MERGE=slack を入れたときだけ(入れていない所では人がマージする。docs/guides/slack.md)",
  );
}
const number = Number(process.argv[2]);
const replyAt = process.argv.indexOf("--reply");
const reply = replyAt > 0 ? (process.argv[replyAt + 1] ?? "").trim() : "";
const option = (name) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? (process.argv[at + 1] ?? "").trim() : "";
};
const sensors = process.argv.includes("--sensors");
if (!Number.isInteger(number) || number <= 0 || (!reply && !sensors) || (reply && sensors)) {
  fail(
    'node scripts/pr-merge-when-green.mjs <PR の番号> --reply "<持ち主の返事>" --answered-at <返した日時(例: 2026-10-29T09:15:00+09:00)>(か、返事の代わりに --sensors)',
  );
}
const answered = sensors ? {} : answeredAtOf(option("--answered-at"));
if (answered.problem) fail(answered.problem);
const where = option("--where") || "会話";

const setup = readFileSync(".github/setup.yml", "utf8");
if (!soloFrom(setup)) {
  fail("人が増えた(承認数が 1 以上)ので、AI はマージしない。レビューの後に人がマージする");
}
if (sensors && !sensorsOnlyFrom(setup)) {
  fail(
    "センサーだけで入れるのは、持ち主が .github/setup.yml の ai_merge.sensors_only を true にした所だけ(今は false。返事を待つ。ADR 0094)",
  );
}

const gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const api = (path) => JSON.parse(gh(["api", path]));
const repo =
  process.env.GH_REPO ??
  gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();

const pr = api(`repos/${repo}/pulls/${number}`);
const bad = prProblems(pr);
if (bad.length > 0) fail(bad.join("・"));

// 人の答えが要る PR か(印と、変えたファイル)。1人の間は会話の答えで進めるので、止めずに記録に書く
const protectedPaths = JSON.parse(readFileSync(".claude/hooks/protected-paths.json", "utf8")).paths;
const areas = parseRiskAreas(readFileSync("docs/concepts/risk-areas.md", "utf8"));
const files = JSON.parse(
  gh(["api", "--paginate", "--slurp", `repos/${repo}/pulls/${number}/files?per_page=100`]),
)
  .flat()
  .map((f) => f.filename);
const needs = () => {
  const labels = api(`repos/${repo}/issues/${number}/labels`).map((l) => l.name);
  const touched = touchedAreas(files, areas);
  // 本文は読み直す(待つ間に問いを足した・危険度を直したかもしれない)
  const body = sensors ? api(`repos/${repo}/pulls/${number}`).body : "";
  return {
    reasons: humanOnlyReasons({ labels, files, protectedPaths }),
    // 触った「高」の領域の問い(コードを読ませずに、1行で答えてもらう。ADR 0084)
    questions: touched.map((a) => `${a.name}: ${a.question}`),
    blockers: sensors
      ? sensorMergeBlockers({
          labels,
          files,
          protectedPaths,
          body,
          questionCount: prQuestions(body).length,
          touchedAreaNames: touched.map((a) => a.name),
        })
      : [],
  };
};
const stopForHuman = (blockers) =>
  fail(
    `人を呼ぶ理由があるので、センサーだけでは入れない(${blockers.join("・")})。持ち主の返事を待つ(判断待ちの積み場 pnpm queue に載る。ADR 0094)`,
  );
const before = needs();
if (sensors && before.blockers.length > 0) stopForHuman(before.blockers);
if (!sensors && before.reasons.length > 0)
  process.stdout.write(
    `人の答えが要る PR(${before.reasons.join("・")})。1人の間なので、会話の答えでマージする(ADR 0085)\n`,
  );

const rules = api(`repos/${repo}/rules/branches/main`);
const queued = mergeQueueOn(rules);
const live = rules
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

// 会話の答えを PR に残す(待つ間に付いた印も書く)。同じ版に当てた記録があれば足さない
const after = needs();
if (sensors && after.blockers.length > 0) stopForHuman(after.blockers);
const comments = api(`repos/${repo}/issues/${number}/comments?per_page=100`);
const recorded = (mark) =>
  comments.some(
    (c) =>
      String(c.body ?? "").startsWith(mark) &&
      String(c.body).includes(`\`${pr.head.sha.slice(0, 7)}\``),
  );
if (sensors) {
  if (!recorded(SENSOR_MARK)) {
    const body = sensorComment({ sha: pr.head.sha, required: required.length, queued });
    gh(["api", "-X", "POST", `repos/${repo}/issues/${number}/comments`, "-f", `body=${body}`]);
  }
} else if (!hasAnswer(comments, pr.head.sha)) {
  const body = answerComment({
    reply,
    answeredAt: answered.at,
    owner: pr.base.repo.owner.login,
    where,
    reasons: after.reasons,
    questions: after.questions,
    sha: pr.head.sha,
  });
  gh(["api", "-X", "POST", `repos/${repo}/issues/${number}/comments`, "-f", `body=${body}`]);
}

// マージキューがあれば、マージせずに並べる(待つ間に push があれば expectedHeadOid で GitHub が断る)。
// キューに並べる道は GraphQL だけ。通らない所(GraphQL を通さない中継)では、人がキューに並べる
if (queued) {
  try {
    gh([
      "api",
      "graphql",
      "-f",
      "query=mutation($id: ID!, $oid: GitObjectID!) { enqueuePullRequest(input: {pullRequestId: $id, expectedHeadOid: $oid}) { mergeQueueEntry { position } } }",
      "-f",
      `id=${pr.node_id}`,
      "-f",
      `oid=${pr.head.sha}`,
    ]);
  } catch (e) {
    fail(
      `マージキューに並べられなかった(${String(e.message ?? e).split("\n")[0]})。人が PR の「Merge when ready」で並べる`,
    );
  }
  process.stdout.write(
    `✅ #${number} をマージキューに並べた(キューの中で必須のチェックをもう一度流し、緑ならキューが入れる)\n`,
  );
  process.exit(0);
}

const how = sensors
  ? "センサーだけでマージ(AI。人を呼ぶ理由なし。ADR 0094)"
  : `持ち主の会話の答えでマージ(AI。仕様 0080・0085。${answered.at.toISOString()}・${where}): ${reply}`;
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
    `commit_message=${how}`,
  ]),
);
if (!merged.merged) fail(`マージできなかった: ${merged.message ?? "理由は不明"}`);
process.stdout.write(`✅ #${number} をマージした(${merged.sha})\n`);

// AI がマージしてよいかの判定(中身だけ。読み書きは pr-merge-when-green.mjs)。仕様 0080。

/** setup.yml の ruleset.required_checks(ジョブの名前の並び。行の後ろの # の注は外す) */
export function requiredChecksFrom(setupYaml) {
  const lines = String(setupYaml ?? "").split("\n");
  const start = lines.findIndex((l) => /^\s*required_checks:\s*$/.test(l));
  if (start < 0) return [];
  const out = [];
  for (const line of lines.slice(start + 1)) {
    const m = line.match(/^\s*-\s+(.+?)\s*(?:#.*)?$/);
    if (!m) break;
    out.push(m[1]);
  }
  return out;
}

const PASSED = new Set(["success", "skipped", "neutral"]);

/**
 * 必須のチェックの今の様子。checkRuns は GitHub の check-runs の形({ name, status, conclusion })。
 * API の既定(filter=latest)で名前ごとに最新の1つだが、念のため同じ名前は先頭の物だけを見る
 */
export function checkState(required, checkRuns) {
  const latest = new Map();
  for (const run of checkRuns) if (!latest.has(run.name)) latest.set(run.name, run);
  const pending = [];
  const failed = [];
  for (const name of required) {
    const run = latest.get(name);
    if (run?.status !== "completed") pending.push(name);
    else if (!PASSED.has(run.conclusion)) failed.push(`${name}(${run.conclusion})`);
  }
  return { pending, failed, green: pending.length === 0 && failed.length === 0 };
}

/** マージの前に PR を見る。問題の文の並び(空なら良い) */
export function prProblems(pr) {
  const problems = [];
  if (pr.state !== "open") problems.push(`PR は ${pr.state}(開いていない)`);
  if (pr.draft) problems.push("下書きの PR");
  if (pr.base?.ref !== "main") problems.push(`向け先が main ではない(${pr.base?.ref})`);
  return problems;
}

// ── 人の答えが要る PR(2026-10-28 のレビューで見つけた穴。1人の間は会話の答えで進める。ADR 0085)──

/** 印が付いていたら人の答えが要る(危険度「高」・テストを弱めた) */
export const HUMAN_ONLY_LABELS = ["risk:high", "tests:weakened"];

/**
 * 守りそのものを変える場所(危険度「高」の一覧に加えて)。ここに触る PR は、自分のチェックを自分で緑にできるので
 * 人の答えが要る(CI・フック・設定・答えの出どころ・テストを弱めた印・このマージのスクリプト)
 */
export const HARNESS_PATHS = [
  ".github/**",
  ".claude/**",
  "CLAUDE.md",
  "scripts/pr-merge-lib.mjs",
  "scripts/pr-merge-when-green.mjs",
  "scripts/decision-evidence.mjs",
  "scripts/decisions-lib.mjs",
  "scripts/test-weakening.mjs",
  "scripts/test-weakening-lib.mjs",
];

/** "x/**" は x/ の下の全部、ほかは同じ名前だけ(フックと同じ当たり方) */
export const matchesPath = (file, pattern) =>
  pattern.endsWith("/**") ? file.startsWith(pattern.slice(0, -2)) : file === pattern;

/**
 * 人の答えが要る理由の並び(空なら、ふつうの返事でマージしてよい)。答えた言葉と一緒に PR の記録に書く。
 * labels は PR の印の名前・files は変えたファイルの道・protectedPaths は危険度「高」の場所(protected-paths.json)
 */
export function humanOnlyReasons({ labels, files, protectedPaths }) {
  const reasons = HUMAN_ONLY_LABELS.filter((l) => labels.includes(l)).map(
    (l) => `印 ${l} が付いている`,
  );
  const patterns = [...new Set([...protectedPaths, ...HARNESS_PATHS])];
  const touched = files.filter((f) => patterns.some((p) => matchesPath(f, p)));
  if (touched.length > 0)
    reasons.push(`危険度「高」・守りの場所を変えている(${touched.slice(0, 5).join("・")})`);
  return reasons;
}

// ── センサーだけで入れる範囲(人を呼ばない。G-135・ADR 0094)──
// 持ち主が setup.yml の ai_merge.sensors_only を true にした所だけ。人の答えが要る理由が1つでもあれば、今までどおり返事を待つ。

/** setup.yml の ai_merge.sensors_only(書いていなければ false)。依存なしで読む(行で見る) */
export function sensorsOnlyFrom(setupYaml) {
  const lines = String(setupYaml ?? "").split("\n");
  const start = lines.findIndex((l) => /^ai_merge:\s*(#.*)?$/.test(l));
  if (start < 0) return false;
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && !/^\s/.test(line)) return false;
    const m = line.match(/^\s+sensors_only:\s*(true|false)\b/);
    if (m) return m[1] === "true";
  }
  return false;
}

/** PR の本文の「⚠️ 危険度」で「高」に印を付けたか */
export const bodySaysHigh = (body) =>
  String(body ?? "")
    .split("\n")
    .some((l) => /^\s*-\s*\[[xX]\]\s*高/.test(l));

/**
 * 人を呼ぶ理由の並び(空ならセンサーだけで入れてよい)。humanOnlyReasons に加えて、
 * 印 needs-human・本文の問い(questionCount)・本文の危険度「高」・触った「高」の領域(touchedAreaNames)を見る
 */
export function sensorMergeBlockers({
  labels,
  files,
  protectedPaths,
  body,
  questionCount,
  touchedAreaNames,
}) {
  const reasons = humanOnlyReasons({ labels, files, protectedPaths });
  if (labels.includes("needs-human")) reasons.push("印 needs-human が付いている");
  if (questionCount > 0)
    reasons.push(`「🧑‍⚖️ 人に判断してほしい所」に問いが ${questionCount} つある`);
  if (bodySaysHigh(body)) reasons.push("本文の危険度が「高」");
  if (touchedAreaNames.length > 0)
    reasons.push(`危険度「高」の領域に触っている(${touchedAreaNames.join("・")})`);
  return reasons;
}

/** センサーだけで入れたことを PR に残すコメントの頭 */
export const SENSOR_MARK = "## センサーだけでマージ(人を呼ばない範囲";

/** センサーだけで入れた記録。sha は確かめた版・required は緑だった必須のチェックの数 */
export const sensorComment = ({ sha, required, queued }) =>
  [
    `${SENSOR_MARK}・ADR 0094)`,
    "",
    `- 当てた版: \`${sha.slice(0, 7)}\`(この版の必須のチェック ${required} 件が全部緑)`,
    "- 人を呼ぶ理由が無かった: 守る場所・「高」の領域に触らない・印(needs-human・risk:high・tests:weakened)が無い・「🧑‍⚖️」の問いが無い・本文の危険度が「高」でない",
    `- 入れ方: ${queued ? "マージキューに並べた(キューの中で必須のチェックをもう一度流す)" : "スカッシュでマージ"}`,
    "",
    "持ち主が .github/setup.yml の ai_merge.sensors_only を true にした所だけで動く。おかしければ revert して、どのセンサーが足りなかったかを書く。",
  ].join("\n");

/** main の規則(rules/branches/main)にマージキューがあるか */
export const mergeQueueOn = (rules) => (rules ?? []).some((r) => r.type === "merge_queue");

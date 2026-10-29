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

// ── 書いた人と別の AI のレビューの記録(G-137・G-139・仕様 0096)──
// /review-pr が、書いた文脈を持たない AI を人格ごとに回し、人が1問ずつ決めた所までを PR に残す。記録が無い PR は AI がマージしない。
// 2026-10-29 にこの PR 自身を5つの人格でレビューし、持ち主が1問ずつ決めた直し(書き手・「直す」の後・版の形・未・回せなかった)を入れた。

/** レビューの記録のコメントの頭 */
export const REVIEW_MARK = "## 🔍 レビューの記録(書いた人と別の AI";
/** 「直す」を直した版を足すコメントの頭(記録は編集せず、これを足していく) */
export const FIX_MARK = "## 🔧 直したこと(レビューの記録の続き";
/** 記録として数える書き手(公開のリポジトリで、外の人のコメントを数えない。decisions-lib と同じ) */
const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const SHA_HEAD = "当てた版: `";
const FIXED_HEAD = "直した版: `";

const startsWithMark = (c, mark) =>
  String(c?.body ?? "")
    .trimStart()
    .startsWith(mark);
const trusted = (c) => TRUSTED.has(c?.author_association);
const isSha = (s) =>
  s.length >= 7 && s.length <= 40 && [...s].every((ch) => "0123456789abcdef".includes(ch));

/** 本文の中の「<head>`…`」を全部取る */
function quotedAfter(body, head) {
  const out = [];
  const text = String(body ?? "");
  for (let at = text.indexOf(head); at >= 0; at = text.indexOf(head, at + 1)) {
    const rest = text.slice(at + head.length);
    const end = rest.indexOf("`");
    if (end >= 0) out.push(rest.slice(0, end));
  }
  return out;
}

/** 記録の「当てた版: `abc1234`」から版を取る(無ければ空) */
export const reviewedShaOf = (body) => quotedAfter(body, SHA_HEAD)[0] ?? "";

/**
 * 記録の決めたことの表(| # | 人格 | 観点 | 所見 | 重さ | 決めたこと | 理由 |)を読む。
 * 重さ・決めたことの列は見出しの名前で探す(列の並びが変わっても読める)
 */
export function reviewDecisions(body) {
  const rows = String(body ?? "")
    .split("\n")
    .filter((l) => l.trimStart().startsWith("|"))
    .map((l) =>
      l
        .trim()
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim()),
    );
  const header = rows.find((r) => r.includes("重さ") && r.includes("決めたこと"));
  if (!header) return [];
  const weight = header.indexOf("重さ");
  const decided = header.indexOf("決めたこと");
  return rows
    .filter(
      (r) => r !== header && !r.every((c) => c.split("").every((ch) => ch === "-" || ch === ":")),
    )
    .map((r) => ({ id: r[0], weight: r[weight] ?? "", decided: r[decided] ?? "" }));
}

const HEAVY = ["❌", "❓"];
const undecided = (d) =>
  d.decided === "" || d.decided.startsWith("未") || d.decided.startsWith("今回は見ない");

/** 記録の「- 回した人格:」の行(無ければ空)。所見の文に同じ言葉が出ても取り違えないよう、この行だけを見る */
export function personasLineOf(body) {
  const line = String(body ?? "")
    .split("\n")
    .find((l) => l.trimStart().startsWith("- 回した人格:"));
  return line ? line.trimStart().slice("- 回した人格:".length).trim() : "";
}

/** 記録そのものの問題(回した人格が無い・回せなかった・版の形・この PR の版でない・決めていない ❌ ❓)。無ければ空 */
function recordProblem(body, sha, inPr) {
  const personas = personasLineOf(body);
  if (!personas)
    return "レビューの記録に「- 回した人格:」の行が無い(/review-pr の記録の形。仕様 0096)";
  if (personas.includes("回せなかった"))
    return "レビューの記録の「回した人格」が「別の AI のレビューを回せなかった」になっている(回してから記録し直す)";
  if (!isSha(sha))
    return `レビューの記録の「当てた版」が版の形でない(16進で7文字以上: ${sha || "空"})`;
  if (!inPr(sha)) return `レビューの記録の「当てた版」${sha} が、この PR の版に無い`;
  const open = reviewDecisions(body).filter(
    (d) => HEAVY.some((w) => d.weight.includes(w)) && undecided(d),
  );
  if (open.length > 0)
    return `❌・❓ の所見に、決めていない物がある(${open.map((d) => d.id).join("・")})。「今回は見ない」の ❌・❓ が残る間は入れない`;
  return "";
}

/** 「直したこと」の問題(「直す」があるのに無い・この PR の版でない)。無ければ空 */
function fixProblem(body, fixes, inPr) {
  if (reviewDecisions(body).some((d) => d.decided.startsWith("直す")) && fixes.length === 0)
    return "「直す」と決めた所見があるのに、「## 🔧 直したこと」の記録が無い(直してから版を書き足す)";
  const bad = fixes.find((f) => !isSha(f) || !inPr(f));
  return bad ? `「直したこと」の版 ${bad} が、この PR の版に無い` : "";
}

/** レビュー(か直した)最後の版より後の、main の取り込みでない版。無ければ空 */
function unreviewedProblem(commits, reviewed, headSha) {
  const order = commits.map((c) => String(c.sha));
  if (order.length === 0)
    return reviewed.some((s) => String(headSha ?? "").startsWith(s))
      ? ""
      : `今の版 ${String(headSha ?? "").slice(0, 7)} が、レビューの記録にも「直したこと」にも無い`;
  const last = Math.max(...reviewed.map((s) => order.findIndex((full) => full.startsWith(s))));
  const after = commits.slice(last + 1).filter((c) => (c.parents ?? []).length < 2);
  return after.length === 0
    ? ""
    : `レビューの後に、レビューを経ていない版がある(${after.map((c) => String(c.sha).slice(0, 7)).join("・")})。直した分なら「## 🔧 直したこと」に版を書く`;
}

/**
 * レビューの記録の様子。problem があれば入れない。
 * - comments: PR のコメント({ body, author_association, html_url, created_at })。持ち主・メンバー・共同作業者の物だけを数える
 * - commits: PR のコミットの並び(古い順。{ sha, parents: [...] })。当てた版・直した版がこの PR の物かと、
 *   その後に足された版がレビューを経ているか(main の取り込み = 親が2つの版だけは、決めたことを変えないので通す)を見る
 */
export function reviewState(comments, headSha, commits = []) {
  const mine = (comments ?? []).filter(trusted);
  const record = mine.filter((c) => startsWithMark(c, REVIEW_MARK)).at(-1);
  if (!record)
    return {
      problem:
        "書いた人と別の AI のレビューの記録が無い(/review-pr で人格ごとに回し、人が1問ずつ決めた記録を PR に残す。持ち主・メンバー・共同作業者の書いた物だけを数える。仕様 0096)",
    };
  const body = String(record.body);
  const sha = reviewedShaOf(body);
  const inPr = (s) => commits.length === 0 || commits.some((c) => String(c.sha).startsWith(s));
  // 記録より後の「直したこと」の版
  const recordAt = String(record.created_at ?? "");
  const fixes = mine
    .filter((c) => startsWithMark(c, FIX_MARK) && String(c.created_at ?? "") >= recordAt)
    .flatMap((c) => quotedAfter(c.body, FIXED_HEAD));
  const problem =
    recordProblem(body, sha, inPr) ||
    fixProblem(body, fixes, inPr) ||
    unreviewedProblem(commits, [sha, ...fixes], headSha);
  return problem ? { problem } : { reviewedSha: sha, url: record.html_url ?? "", fixes };
}

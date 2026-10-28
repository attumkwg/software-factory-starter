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

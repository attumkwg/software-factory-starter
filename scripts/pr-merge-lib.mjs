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

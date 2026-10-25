// PreToolUse(Edit・Write・MultiEdit・NotebookEdit): 危険度「高」の場所(protected-paths.json)を書くときは人に聞く(ask)。
// auto モードでも効く。使う人が手元の env に KIT_EDIT_GUARD=pr と書いたときだけ聞かずに通し、
// PR の段(risk:high のラベル・CODEOWNERS・PR 本文の危険度と人に判断してほしい所)を最後の確認にする。
// 既定(変数なし)は聞く。キットの既定は弱めない。docs/guides/local-guards.md・ADR 0034
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { paths } = JSON.parse(readFileSync(join(here, "protected-paths.json"), "utf8"));

export const GUARD_OFF_REASON =
  "KIT_EDIT_GUARD=pr なので確認を出しません。PR の危険度と人に判断してほしい所で確かめる(危険度「高」にして、変えた理由を書く)";

// 手元で外しているか。pr のときだけ(ほかの値・空は既定のまま聞く)
export const guardOff = (env = process.env) => env.KIT_EDIT_GUARD === "pr";

// プロジェクトの根からの道(/ 区切り)。worktree(.claude/worktrees/<名前>/)の中は、その中からの道にする
export function relativePath(file, root) {
  const rel = relative(root, resolve(root, file)).replaceAll("\\", "/");
  return rel.replace(/^\.claude\/worktrees\/[^/]+\//, "");
}

// settings.json の Edit(./infra/**) と同じ当たり方: "x/**" は x/ の下の全部、ほかは同じ名前だけ
export const matchProtected = (rel) =>
  paths.filter((p) => (p.endsWith("/**") ? rel.startsWith(p.slice(0, -2)) : rel === p));

// { decision: "ask" | "pass", reason } か null(当たらない。ふつうに通す)
export function decide(file, root, env = process.env) {
  const touched = matchProtected(relativePath(file, root));
  if (touched.length === 0) return null;
  if (guardOff(env)) return { decision: "pass", reason: GUARD_OFF_REASON };
  return {
    decision: "ask",
    reason: `危険度「高」の場所(${touched.join("・")})を書きます。人が確かめてください(手元で外すなら docs/guides/local-guards.md)`,
  };
}

// フックの返事。ask は確認を出す。pass は確認を出さず、人と AI に理由だけ見せる(権限はふだんの扱いのまま)
export function hookOutput(result) {
  if (result.decision === "pass") {
    return {
      systemMessage: result.reason,
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: result.reason },
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: result.decision,
      permissionDecisionReason: result.reason,
    },
  };
}

function main() {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (!file) return;
  const { env } = process;
  const root = env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const result = decide(file, root, env);
  if (result) process.stdout.write(JSON.stringify(hookOutput(result)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();

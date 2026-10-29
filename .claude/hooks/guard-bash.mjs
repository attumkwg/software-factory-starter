// PreToolUse(Bash): settings.json の deny と編集のフック(guard-edit.mjs)を Bash で回り道されないようにする(auto モードでも効く)。
// - main への push・強制 push・ブランチの削除・PR のマージと承認は止める(deny。KIT_EDIT_GUARD に関係なく)。
//   例外は1つ: 持ち主が環境(手元かクラウド)に KIT_AI_MERGE=slack を入れたときの scripts/pr-merge-when-green.mjs(使う人が選ぶ。既定はオフ。ADR 0086)
//   (持ち主の会話の返事+必須のチェックが全部緑のときだけ。仕様 0080)。変数をコマンドの中で入れるのは止める
// - 危険度「高」の場所(protected-paths.json)に触る、読むだけでないコマンドは人に聞く(ask)。
//   手元の env に KIT_EDIT_GUARD=pr と書いたときだけ、この確認を出さずに通す(編集のフックと同じ)
// 完全ではない(スクリプトの中で書くもの・変数で組み立てた道は見えない)。疑わしいときは聞く側に倒す。
// 最後の守りは PR の risk:high ラベル(labeler)と人のレビュー。docs/guides/local-guards.md
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GUARD_OFF_REASON, guardOff, hookOutput } from "./guard-edit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { paths } = JSON.parse(readFileSync(join(here, "protected-paths.json"), "utf8"));

const PROTECTED_BRANCHES = new Set(["main", "master"]);
const READ_ONLY = new Set([
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "grep",
  "rg",
  "ls",
  "wc",
  "diff",
  "stat",
  "file",
  "jq",
  "awk",
  "echo",
  "printf",
  "pwd",
  "tree",
  "du",
  "realpath",
  "cd",
]);
const READ_ONLY_GIT = new Set(["diff", "log", "show", "status", "blame", "grep", "ls-files"]);
const DANGEROUS_PUSH_FLAG =
  /^(-f|--force(-with-lease)?(=.*)?|--force-if-includes|--mirror|--delete|-d|--no-verify|--all|--prune)$/;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const words = (segment) => segment.trim().split(/\s+/).filter(Boolean);
const segments = (command) => command.split(/&&|\|\||[;|\n]/).filter((s) => s.trim());

// git の後ろの最初のサブコマンド(-C <dir>・-c <k=v> は飛ばす)と、その後ろの引数
function gitParts(ws) {
  let i = ws.indexOf("git");
  if (i === -1) return null;
  for (i += 1; i < ws.length; i += 1) {
    if (ws[i] === "-C" || ws[i] === "-c") i += 1;
    else if (!ws[i].startsWith("-")) return { sub: ws[i], args: ws.slice(i + 1) };
  }
  return null;
}

// push の行き先のブランチ(refspec の右側。HEAD と省略は今のブランチ)
function pushTargets(args, currentBranch) {
  const positional = args.filter((a) => !a.startsWith("-"));
  const refspecs = positional.slice(1);
  if (refspecs.length === 0) return [currentBranch()];
  return refspecs.map((r) => {
    const target = (r.includes(":") ? r.split(":").pop() : r).replace(/^refs\/heads\//, "");
    return target === "HEAD" ? currentBranch() : target;
  });
}

function checkPush(segment, currentBranch) {
  const git = gitParts(words(segment));
  if (git?.sub !== "push") return null;
  const bad = git.args.find((a) => DANGEROUS_PUSH_FLAG.test(a) || a.startsWith("+"));
  if (bad) return `git push の ${bad} は使わない(履歴を消す・検査を飛ばす)。人に頼んでください`;
  const target = pushTargets(git.args, currentBranch).find((b) => PROTECTED_BRANCHES.has(b));
  if (target) return `${target} へ直接 push しない。ブランチを切って PR にしてください`;
  return null;
}

const AI_MERGE_SCRIPT = /pr-merge-when-green\.mjs|pr:merge-when-green/;

function checkMerge(segment, env) {
  const s = segment.replace(/\s+/g, " ");
  if (/\bKIT_AI_MERGE\b/.test(s))
    return "KIT_AI_MERGE は持ち主が自分で環境に入れるスイッチ(AI はコマンドの中で入れない。ADR 0086)";
  if (AI_MERGE_SCRIPT.test(s) && env.KIT_AI_MERGE !== "slack")
    return "AI のマージは、持ち主が環境に KIT_AI_MERGE=slack を入れたときだけ(使う人が選ぶ。入れていなければ人がマージする。ADR 0086)";
  if (/\bgh pr merge\b/.test(s))
    return "gh pr merge は使わない(人がマージする。持ち主がオンにした所の AI のマージは pnpm pr:merge-when-green だけ)";
  if (/\bgh pr review\b/.test(s) && /--approve|-a\b/.test(s))
    return "PR の承認は人がする(AI は承認しない)";
  if (/\bgh api\b/.test(s) && /\/merges?\b/.test(s)) return "gh api でのマージもしない";
  return null;
}

// 未確定事項への人の答え(「U-1 承認」など)を、AI が人のアカウントで GitHub に書かない(G-61・仕様 0061)。
// 手元の gh は人のアカウントなので、CI(decision-evidence.mjs)は人の答えと見分けられない。だから書く前に聞く
const ANSWER_POST = /\bgh\s+(?:(?:pr|issue)\s+(?:comment|review)|api)\b/;
const ANSWER_WORDS = /\bU-\d+\s*[::]?\s*(?:承認|変更|保留|導入時に決める)/;
function checkAnswerPost(command) {
  if (!ANSWER_POST.test(command) || !ANSWER_WORDS.test(command)) return null;
  return "未確定事項への人の答え(U-n 承認 など)を書こうとしています。答えは人が自分で GitHub に書く(AI は写さない)。人が確かめてください";
}

// 2>&1・>/dev/null のような害の無いものを除いて、まだ > が残れば「書く」
const writesByRedirect = (segment) =>
  />/.test(segment.replace(/\d?>&\d|&?\d?>+\s*\/dev\/null/g, ""));

function isReadOnly(segment) {
  if (writesByRedirect(segment)) return false;
  const ws = words(segment).filter((w) => !/^[A-Za-z_]+=/.test(w));
  const cmd = (ws[0] ?? "").split("/").pop();
  if (READ_ONLY.has(cmd)) return true;
  if (cmd === "sed") return !ws.some((w) => w.startsWith("-i") || w === "--in-place");
  if (cmd === "find") return !ws.some((w) => /^-(delete|exec|execdir|ok|fprint)/.test(w));
  if (cmd === "git") return READ_ONLY_GIT.has(gitParts(ws)?.sub);
  return false;
}

// 場所ごとの当たり方: "infra/…" か、引数としての "infra"(先頭の "docker compose" の docker は除く)。
// ファイルは名前の前後が区切り(引用符・空白・/)のとき
const patterns = paths.map((p) => {
  if (!p.endsWith("/**")) return { p, re: [new RegExp(`(^|[^\\w.-])${escapeRe(p)}(?![\\w.-])`)] };
  const base = escapeRe(p.slice(0, -3));
  const before = `(^|[\\s"'=/(])`;
  return { p, re: [new RegExp(`${before}${base}/`), new RegExp(`\\S\\s+${base}(?=$|[\\s"')])`)] };
});

export function touchedProtected(command) {
  const parts = segments(command.replaceAll("\\", "/")).map((s) => s.trim());
  return patterns
    .filter(({ re }) => parts.some((s) => re.some((r) => r.test(s))))
    .map(({ p }) => p);
}

// { decision: "deny" | "ask" | "pass", reason } か null(ふつうに通す)。deny は env に関係なく止める
export function decide(command, currentBranch = () => "", env = process.env) {
  for (const segment of segments(command)) {
    const reason = checkPush(segment, currentBranch) ?? checkMerge(segment, env);
    if (reason) return { decision: "deny", reason };
  }
  // KIT_EDIT_GUARD に関係なく聞く(人の答えは、人が書いたことが値打ち)
  const answer = checkAnswerPost(command);
  if (answer) return { decision: "ask", reason: answer };
  const touched = touchedProtected(command);
  if (touched.length > 0 && !segments(command).every(isReadOnly)) {
    if (guardOff(env)) return { decision: "pass", reason: GUARD_OFF_REASON };
    return {
      decision: "ask",
      reason: `危険度「高」の場所(${touched.join("・")})を変えるかもしれないコマンドです。人が確かめてください`,
    };
  }
  return null;
}

function main() {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  if (input.tool_name !== "Bash") return;
  const currentBranch = () =>
    spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const result = decide(input.tool_input?.command ?? "", currentBranch);
  if (result) process.stdout.write(JSON.stringify(hookOutput(result)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();

// PostToolUse: AI が外へ向けてした操作を1行ずつ記録する(docs/designs/0057-ai-egress.md の 5・6)。
// 書くのは時刻・手段・宛先だけ(中身・個人データは書かない。AI-6)。書き先は .claude/outbound.log(git に載せない)。
// PR の本文の「🚪 外へ出した物」は `pnpm outbound` がこの記録から表にする(頼まれていたかは AI が書き足す)。
// 記録に失敗しても、道具の結果は変えない(いつも exit 0)。
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const GH_WRITES = ["create", "comment", "edit", "review", "close", "reopen"];
const GH_API_WRITE_FLAGS = ["-X", "--method", "-f", "-F", "--field", "--raw-field", "--input"];
const FETCHERS = ["curl", "wget", "http", "https", "Invoke-WebRequest", "Invoke-RestMethod"];

// コマンドの種類ごとの読み方。words はコマンドを空白で分けた物。当たらなければ null
const READERS = [
  (words) => {
    if (words[0] !== "git" || !words.includes("push")) return null;
    const after = words.slice(words.indexOf("push") + 1).filter((w) => !w.startsWith("-"));
    return { means: "git push", target: after.join(" ") || "(既定の宛先)" };
  },
  ([head, sub, verb, ...rest]) => {
    if (head !== "gh" || !["pr", "issue"].includes(sub) || !GH_WRITES.includes(verb)) return null;
    const at = rest.indexOf("--repo");
    return {
      means: `gh ${sub} ${verb}`,
      target: at >= 0 ? (rest[at + 1] ?? "?") : "このリポジトリ",
    };
  },
  (words) => {
    if (words[0] !== "gh" || words[1] !== "api") return null;
    if (!words.some((w) => GH_API_WRITE_FLAGS.includes(w))) return null;
    return { means: "gh api(書き込み)", target: words[2] ?? "?" };
  },
  (words) => {
    if (!["npm", "pnpm", "yarn"].includes(words[0]) || !words.includes("publish")) return null;
    return { means: `${words[0]} publish`, target: "パッケージの置き場" };
  },
  (words) => {
    if (!FETCHERS.includes(words[0])) return null;
    const url = words.find((w) => /^["']?https?:\/\//.test(w));
    return { means: words[0], target: url ? hostOf(url.replace(/^["']/, "")) : "?" };
  },
];

/** 1つのコマンド(&& ; | や改行で区切った後)から、外向きの操作を読む。無ければ null */
function classifyCommand(cmd) {
  const words = cmd.trim().split(/\s+/);
  for (const read of READERS) {
    const found = read(words);
    if (found) return found;
  }
  return null;
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "?";
  }
}

/** 道具の名前と入力から、外向きの操作の一覧(無ければ空) */
export function classify(toolName, toolInput = {}) {
  if (toolName === "WebFetch") return [{ means: "WebFetch", target: hostOf(toolInput.url) }];
  // 検索の言葉は中身なので書かない
  if (toolName === "WebSearch") return [{ means: "WebSearch", target: "検索" }];
  if (typeof toolName === "string" && toolName.startsWith("mcp__")) {
    const [, server = "?", tool = "?"] = toolName.split("__");
    return [{ means: "MCP", target: `${server} の ${tool}` }];
  }
  if (toolName === "Bash" && typeof toolInput.command === "string") {
    return toolInput.command
      .split(/&&|\|\||;|\||\n/)
      .map(classifyCommand)
      .filter((x) => x !== null);
  }
  return [];
}

/** 記録の1行(JSON) */
export function lines(input, now = new Date()) {
  return classify(input.tool_name, input.tool_input).map((o) =>
    JSON.stringify({ at: now.toISOString(), tool: input.tool_name, ...o }),
  );
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    const input = JSON.parse(readFileSync(0, "utf8") || "{}");
    const out = lines(input);
    if (out.length > 0) {
      const dir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
      appendFileSync(join(dir, ".claude", "outbound.log"), `${out.join("\n")}\n`);
    }
  } catch {
    // 記録できなくても、道具の結果は変えない
  }
  process.exit(0);
}

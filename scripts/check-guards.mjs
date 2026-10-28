// 危険度「高」の場所の一覧(.claude/hooks/protected-paths.json)が、守りとずれていないかを見る。
// 2026-10-20 の点検で、CLAUDE.md・ラベル・CODEOWNERS は「高」なのに AI の確認(ask)から抜けていた所が6つあった。
// 一覧に足したのに守りに足し忘れたら、ここで落ちる。手元の確認は2つのフック(編集 guard-edit.mjs・Bash guard-bash.mjs)が
// 一覧をじかに読むので、ここではフックが settings.json に付いているかを見て、続けてフックのテストを流す。docs/guides/local-guards.md
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
  highWordsFromLine,
  parseMediumPlaces,
  parseRiskAreas,
  riskAreaProblems,
} from "./risk-areas-lib.mjs";

const read = (f) => readFileSync(f, "utf8");
const { paths } = JSON.parse(read(".claude/hooks/protected-paths.json"));
const settings = JSON.parse(read(".claude/settings.json"));
const labeler = read(".github/labeler.yml");
const codeowners = read(".github/CODEOWNERS");
const claudeMd = read("CLAUDE.md");

// labeler の risk:high の塊(次の最上位の鍵まで)
const high = labeler.split(/^"risk:medium":/m)[0];
const ownerLines = codeowners.split("\n").map((l) => l.trim().split(/\s+/)[0]);
const ownerPath = (p) => `/${p.replace(/\*\*$/, "")}`;

const missing = [];
for (const p of paths) {
  if (!high.includes(`- ${p}\n`)) missing.push(`.github/labeler.yml の risk:high に ${p} が無い`);
  if (!ownerLines.includes(ownerPath(p)))
    missing.push(`.github/CODEOWNERS に ${ownerPath(p)} が無い`);
}
// 文書の危険度の表(line.md の「高」・risk-areas.md)と守る場所の一覧が合っているか(ADR 0083)
const riskAreasMd = read("docs/concepts/risk-areas.md");
missing.push(
  ...riskAreaProblems({
    areas: parseRiskAreas(riskAreasMd),
    medium: parseMediumPlaces(riskAreasMd),
    highWords: highWordsFromLine(read("docs/concepts/line.md")),
    protectedPaths: paths,
    apiDirs: readdirSync("apps/api/src", { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name),
    exists: existsSync,
  }),
);
if (!claudeMd.includes(".claude/hooks/protected-paths.json"))
  missing.push("CLAUDE.md が .claude/hooks/protected-paths.json を指していない");

// PreToolUse に、そのフックを、その道具の全部に付けているか
const preToolUse = settings.hooks?.PreToolUse ?? [];
const hooked = (script, tool) =>
  preToolUse.some(
    (h) =>
      (h.matcher ?? "").split("|").includes(tool) &&
      h.hooks.some((x) => x.command.includes(script)),
  );
if (!hooked("guard-bash.mjs", "Bash"))
  missing.push(".claude/settings.json の PreToolUse に guard-bash.mjs(Bash)が無い");
// 外へ書く文章の秘密を止める(G-58)。背景の AI もこの settings.json を使う
// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret -- フックのファイル名で、秘密ではない
if (!hooked("guard-secrets-out.mjs", "Bash"))
  missing.push(".claude/settings.json の PreToolUse に guard-secrets-out.mjs(Bash)が無い");
for (const tool of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) {
  if (!hooked("guard-edit.mjs", tool))
    missing.push(`.claude/settings.json の PreToolUse に guard-edit.mjs(${tool})が無い`);
}
// 一覧を settings.json の ask にも書くと、手元で KIT_EDIT_GUARD=pr にしても外れない(ADR 0034)
const asks = (settings.permissions?.ask ?? []).filter((a) => /^(Edit|Write)\(/.test(a));
if (asks.length > 0)
  missing.push(
    `.claude/settings.json の ask に Edit・Write が残っている(${asks.length} 件)。確認は guard-edit.mjs に任せる`,
  );

if (missing.length > 0) {
  process.stderr.write(`危険度「高」の守りがずれています:\n- ${missing.join("\n- ")}\n`);
  process.exit(1);
}
process.stdout.write(
  `守り(ラベル・CODEOWNERS・3つのフック)は一覧(${paths.length} 件)とそろっています\n`,
);

const t = spawnSync(
  process.execPath,
  [
    "--test",
    ".claude/hooks/guard-bash.test.mjs",
    ".claude/hooks/guard-edit.test.mjs",
    ".claude/hooks/record-outbound.test.mjs",
    ".claude/hooks/guard-secrets-out.test.mjs",
  ],
  { stdio: "inherit" },
);
process.exit(t.status ?? 1);

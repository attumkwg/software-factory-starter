// 危険度「高」の場所の一覧(.claude/hooks/protected-paths.json)が、守りの4か所とずれていないかを見る。
// 2026-10-20 の点検で、CLAUDE.md・ラベル・CODEOWNERS は「高」なのに AI の確認(ask)から抜けていた所が6つあった。
// 一覧に足したのに守りに足し忘れたら、ここで落ちる。続けて Bash のフックのテストも流す。docs/guides/local-guards.md
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

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
  for (const tool of ["Edit", "Write"]) {
    if (!settings.permissions.ask.includes(`${tool}(./${p})`))
      missing.push(`.claude/settings.json の ask に ${tool}(./${p}) が無い`);
  }
  if (!high.includes(`- ${p}\n`)) missing.push(`.github/labeler.yml の risk:high に ${p} が無い`);
  if (!ownerLines.includes(ownerPath(p)))
    missing.push(`.github/CODEOWNERS に ${ownerPath(p)} が無い`);
}
if (!claudeMd.includes(".claude/hooks/protected-paths.json"))
  missing.push("CLAUDE.md が .claude/hooks/protected-paths.json を指していない");
const hook = settings.hooks?.PreToolUse?.some((h) =>
  h.hooks.some((x) => x.command.includes("guard-bash.mjs")),
);
if (!hook) missing.push(".claude/settings.json の PreToolUse に guard-bash.mjs が無い");

if (missing.length > 0) {
  process.stderr.write(`危険度「高」の守りがずれています:\n- ${missing.join("\n- ")}\n`);
  process.exit(1);
}
process.stdout.write(`守りの4か所は一覧(${paths.length} 件)とそろっています\n`);

const t = spawnSync(process.execPath, ["--test", ".claude/hooks/guard-bash.test.mjs"], {
  stdio: "inherit",
});
process.exit(t.status ?? 1);

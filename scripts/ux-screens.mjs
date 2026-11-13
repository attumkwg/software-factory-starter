#!/usr/bin/env node
// pnpm ux:screens <PR の番号>
// 🎨 使いやすさを見る人に渡す画面の画像を、一時フォルダに取り出して場所を並べる(仕様 0099・/review-pr の 1.5)。
// 変わる前は main(origin/main)、後は PR の版。書くのは一時フォルダだけ(リポジトリには書かない)。
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planShots, SHOTS_DIR, touchesScreens } from "./ux-screens-lib.mjs";

const pr = process.argv[2];
if (!/^\d+$/.test(pr ?? "")) {
  console.error("使い方: pnpm ux:screens <PR の番号>");
  process.exit(2);
}

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", ...opts });
const head = run("gh", ["pr", "view", pr, "--json", "headRefOid", "-q", ".headRefOid"]).trim();
run("git", ["fetch", "--quiet", "origin", "main", `pull/${pr}/head`]);
const changed = run("gh", ["pr", "diff", pr, "--name-only"]).split("\n").filter(Boolean);
const headShots = run("git", ["ls-tree", "-r", "--name-only", head, "--", SHOTS_DIR])
  .split("\n")
  .filter(Boolean);

if (!touchesScreens(changed))
  console.log("⚠️ この PR は画面の道(apps/web/src・packages/ui・apps/site)に触っていない");

const { changedShots, files } = planShots(changed, headShots);
const dir = mkdtempSync(join(tmpdir(), `ux-screens-${pr}-`));
const written = [];
for (const f of files) {
  const rev = f.side === "before" ? "origin/main" : head;
  try {
    const png = execFileSync("git", ["show", `${rev}:${f.path}`], { maxBuffer: 64 * 1024 * 1024 });
    writeFileSync(join(dir, f.name), png);
    written.push(join(dir, f.name));
  } catch {
    // 新しく足した画面は main に無い(before が無い)
  }
}

console.log(
  changedShots
    ? "変わった画像あり(before-* と after-* を並べて見る)"
    : "変わった画像なし(PR の版の画像を全部 after-* で出した)",
);
console.log(`当てた版: ${head.slice(0, 7)}`);
for (const p of written) console.log(p);

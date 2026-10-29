// 変えた設計書の「7. 要求との対応」が、受け入れ条件の1つずつにテストのファイルを名指しているかを確かめる(CI)。
//   pnpm design-tests                    元(origin/main)から変えた設計書だけを見る(まだコミットしていない物も)
//   pnpm design-tests --base <ref>       元を変える(CI は HEAD^1 = PR を合わせたコミットの1つ目の親)
//   pnpm design-tests <ファイル>…         指定した設計書を見る(変えたかどうかに関わらず)
// 次があれば 1 で終わる: 節・表・「テスト」の列が無い / テストの欄にファイルのパスが無い行 /
//   状態が「完了」なのに、書いたパスのファイルが無い。状態が「完了」でなければ、無いファイルは出すだけ(設計は実装より先に入る)。
// 変えた設計書だけを見る: 新しい設計書と、「要求との対応」の節か状態を変えた物(昔の設計書はパスを書いていない物が多い。
//   表に触れたときに合わせる。文の直し・リンクの付け替えだけなら見ない)。
// 中身は design-tests-lib.mjs、決まりは docs/designs/0093-design-test-paths.md。
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { checkDesign, designFiles, needsCheck } from "./design-tests-lib.mjs";

const args = process.argv.slice(2);
const baseAt = args.indexOf("--base");
const base = baseAt === -1 ? "origin/main" : args[baseAt + 1];
const given = args.filter((arg, i) => !arg.startsWith("--") && (baseAt === -1 || i !== baseAt + 1));

const git = (...gitArgs) =>
  execFileSync("git", gitArgs, { encoding: "utf8" }).split("\n").filter(Boolean);

/** 元の版の中身(元に無い = 新しい設計書なら null) */
function before(from, file) {
  try {
    return execFileSync("git", ["show", `${from}:${file}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function changedDesigns() {
  try {
    const [from] = git("merge-base", base, "HEAD");
    // 作業中の物(コミット前・まだ git に無い物)も入れる。消した物は見ない
    const changed = git("diff", "--name-only", "--no-renames", "--diff-filter=d", from);
    const added = git("ls-files", "--others", "--exclude-standard", "docs/designs");
    const files = designFiles([...new Set([...changed, ...added])]);
    // 新しい設計書・「要求との対応」の節か状態を変えた物だけ(文の直し・リンクの付け替えだけなら見ない)
    return files.filter((file) => needsCheck(before(from, file), readFileSync(file, "utf8")));
  } catch {
    console.error(
      `❌ 元(${base})と比べられない。手元なら git fetch origin、CI なら checkout の fetch-depth を確かめる(--base で元を渡せる)`,
    );
    process.exit(1);
  }
}

// テストのパスは、リポジトリの根からでも、各パッケージ(apps/*・packages/*)の中からでもよい
// (昔の設計書は `test/integration/…` のように apps/api の中から書いている)
const roots = [""];
for (const dir of ["apps", "packages"]) {
  if (!existsSync(dir)) continue;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) roots.push(`${dir}/${entry.name}/`);
  }
}
const exists = (path) => roots.some((root) => existsSync(`${root}${path}`));

const files = given.length > 0 ? given : changedDesigns();
if (files.length === 0) {
  console.log(`✅ 元(${base})から、要求との対応か状態を変えた設計書はありません`);
  process.exit(0);
}
let count = 0;
for (const file of files) {
  const { problems, waiting } = checkDesign(readFileSync(file, "utf8"), exists);
  for (const problem of problems) console.log(`${file}: ${problem}`);
  for (const note of waiting) console.log(`${file}: ${note}`);
  count += problems.length;
}
if (count > 0) {
  console.log(
    `\n❌ 要求との対応: ${count}件。受け入れ条件ごとに、確かめるテストのファイルを書く(docs/designs/_template.md の 7)`,
  );
  process.exit(1);
}
console.log(`✅ ${files.length}本の設計書で、受け入れ条件ごとにテストのファイルを名指しています`);

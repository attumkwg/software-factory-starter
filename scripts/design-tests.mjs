// 変えた設計書の「7. 要求との対応」が、受け入れ条件の1つずつにテストのファイルを名指しているかを確かめる(CI)。
//   pnpm design-tests                    元(origin/main)から変えた設計書を見る(まだコミットしていない物も)
//   pnpm design-tests --base <ref>       元を変える(CI は HEAD^1 = PR を合わせたコミットの1つ目の親)
//   pnpm design-tests <ファイル>…         指定した設計書を見る(変えたかどうかに関わらず)
// 次があれば 1 で終わる: 新しい設計書の状態が読めない / 節・表・「テスト」の列が無い /
//   テストのファイルのパスも「(手で確かめる: 理由)」も無い行 / リポジトリの外を指すパス /
//   設計書か指す仕様の状態が「完了」なのに、書いたパスのファイルが無い。「完了」でなければ、無いファイルは出すだけ(設計は実装より先に入る)。
// 見る設計書: 新しい物・「要求との対応」の節か状態を変えた物・この PR で「完了」にした仕様を指す物
//   (昔の設計書はパスを書いていない物が多い。表に触れたときに合わせる。文の直し・リンクの付け替えだけなら見ない)。
// 中身は design-tests-lib.mjs、決まりは docs/designs/0097-design-test-paths.md。
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
  baseStatus,
  checkDesign,
  designFiles,
  pathRoots,
  selectDesigns,
  specOf,
  splitZ,
  stateWord,
} from "./design-tests-lib.mjs";

const args = process.argv.slice(2);
const baseAt = args.indexOf("--base");
const base = baseAt === -1 ? "origin/main" : args[baseAt + 1];
const given = args.filter((arg, i) => !arg.startsWith("--") && (baseAt === -1 || i !== baseAt + 1));

/** git を呼ぶ(失敗は null。読めないファイルなどの失敗は、ここでは包まずにそのまま落とす) */
function git(...gitArgs) {
  const r = spawnSync("git", gitArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return r.status === 0 ? r.stdout : null;
}

function stop(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

/** 元から変えた設計書と仕様の名前(作業中の物・git にまだ無い物も。消した物は見ない)と、分かれ目のコミット */
function changedFiles() {
  const status = baseStatus({
    base,
    resolved: git("rev-parse", "--verify", "--quiet", `${base}^{commit}`) !== null,
    hasParent: git("rev-parse", "--verify", "--quiet", "HEAD^1") !== null,
    shallow: git("rev-parse", "--is-shallow-repository")?.trim() === "true",
  });
  if (status.skip) {
    console.log(`✅ ${status.skip}`);
    process.exit(0);
  }
  if (status.error) stop(status.error);
  const from = git("merge-base", base, "HEAD")?.trim();
  if (!from) stop(`元(${base})との分かれ目が分からない(浅い checkout なら fetch-depth を確かめる)`);
  const changed = git("diff", "-z", "--name-only", "--no-renames", "--diff-filter=d", from);
  const added = git(
    "ls-files",
    "-z",
    "--others",
    "--exclude-standard",
    "docs/designs",
    "docs/specs",
  );
  if (changed === null || added === null) stop("git で変えたファイルが読めない");
  const names = [...new Set([...splitZ(changed), ...splitZ(added)])];
  return { from, names };
}

const read = (file) => readFileSync(file, "utf8");
const designsDir = "docs/designs";
const allDesigns = () =>
  designFiles(readdirSync(designsDir).map((f) => `${designsDir}/${f}`)).map((file) => ({
    file,
    text: read(file),
  }));

function selected() {
  if (given.length > 0) return given.map((file) => ({ file, isNew: false }));
  const { from, names } = changedFiles();
  const changes = names
    .filter(
      (n) => n.endsWith(".md") && (n.startsWith("docs/designs/") || n.startsWith("docs/specs/")),
    )
    .map((file) => ({ file, before: git("show", `${from}:${file}`), after: read(file) }));
  return selectDesigns(changes, allDesigns());
}

const listDirs = (top) =>
  existsSync(top)
    ? readdirSync(top, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    : [];
const roots = pathRoots({ apps: listDirs("apps"), packages: listDirs("packages") });
const exists = (path) => roots.some((root) => existsSync(`${root}${path}`));

const targets = selected();
if (targets.length === 0) {
  console.log(
    `✅ 元(${base})から、見る設計書はありません(新しい物・要求との対応か状態を変えた物・完了にした仕様を指す物)`,
  );
  process.exit(0);
}
let count = 0;
for (const { file, isNew } of targets) {
  const text = read(file);
  const spec = specOf(text.replaceAll("\r\n", "\n"));
  const specState = spec && existsSync(spec) ? stateWord(read(spec).replaceAll("\r\n", "\n")) : "";
  const { problems, waiting, manual } = checkDesign(text, { exists, specState, isNew });
  for (const line of [...problems, ...waiting, ...manual]) console.log(`${file}: ${line}`);
  count += problems.length;
}
if (count > 0) {
  console.log(
    `\n❌ 要求との対応: ${count}件。受け入れ条件ごとに、確かめるテストのファイルを書く(docs/designs/_template.md の 7)`,
  );
  process.exit(1);
}
console.log(
  `✅ ${targets.length}本の設計書で、受け入れ条件ごとにテストのファイルか「手で確かめる」を書いています`,
);

// pnpm setup:github: GitHub の設定を .github/setup.yml・.github/labels.yml にそろえる(使い始める前に一括で)。
//   pnpm setup:github                    今の設定との差分と「人がやること」を出す(何も書き換えない)
//   pnpm setup:github --apply            差分を反映し、読み直して残りを出す(何度流しても同じ。失敗が1つでもあれば 1)
//   pnpm setup:github --repo owner/name  ほかのリポジトリ(既定は手元の gh repo view)
// リポジトリの管理者の gh のログインで流す。秘密の値は入れない(名前だけ確かめる)。消さない。
// 決まり: docs/designs/0014-setup-before-use.md・手順: docs/guides/github-setup.md
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, validateLabels, validateSetup } from "./config.mjs";
import { currentRepo, makeGitHub } from "./github.mjs";
import { apply, countDiffs, plan, render } from "./plan.mjs";

const args = process.argv.slice(2);
const at = args.indexOf("--repo");
const repo = at >= 0 ? args[at + 1] : currentRepo();
const applying = args.includes("--apply");

const { setup, labels } = loadConfig();
const problems = [...validateSetup(setup), ...validateLabels(labels)];
if (problems.length > 0) {
  console.error(
    `❌ 設定ファイルの書き方の問題: ${problems.length}件(pnpm setup:check でも見られる)`,
  );
  for (const p of problems) console.error(`- ${p}`);
  process.exit(1);
}
if (!repo) {
  console.error(
    "❌ リポジトリが分からない(gh repo view が通らない)。gh auth login するか --repo owner/name",
  );
  process.exit(1);
}

const root = process.cwd();
const src = {
  read: (f) => (existsSync(join(root, f)) ? readFileSync(join(root, f), "utf8") : undefined),
};
const gh = makeGitHub(repo);
const first = plan({ gh, setup, labels, src });
if (first.error) {
  console.error(`❌ ${first.error}(リポジトリの管理者の gh のログインで流す)`);
  process.exit(1);
}

if (!applying) {
  console.log(render(first));
  process.exit(0);
}

const applied = apply(first);
const after = plan({ gh, setup, labels, src });
console.log(render(after.error ? first : after, { applying: true, applied }));
const failed = applied.filter((a) => !a.ok).length;
const left = after.error ? undefined : countDiffs(after);
console.log(
  `反映: ${applied.length - failed}件 成功・${failed}件 失敗。読み直した残りの差分: ${left ?? "読めなかった"}件`,
);
process.exit(failed > 0 ? 1 : 0);

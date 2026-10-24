// pnpm setup:check: GitHub を読まずに、.github/setup.yml・.github/labels.yml とコードのずれを見る(CI の「Biome・型・単体」)。
//   - 使われているラベルが一覧に無い / 必須のチェックが PR で動くジョブに無い / Environment が無い /
//     定期で動くワークフローに KIT_ROLE の見分けが無い → 1 で終わる
// 決まり: docs/designs/0014-setup-before-use.md の 3.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ENVIRONMENTS } from "../checkup/checks/github-environments.mjs";
import { checkAll } from "./check-lib.mjs";
import { LABELS_FILE, loadConfig, SETUP_FILE } from "./config.mjs";

const root = process.cwd();
const src = {
  read: (f) => (existsSync(join(root, f)) ? readFileSync(join(root, f), "utf8") : undefined),
  list: (dir) =>
    existsSync(join(root, dir))
      ? readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
          .filter((d) => d.isFile())
          .map((d) => relative(root, join(d.parentPath, d.name)).replaceAll("\\", "/"))
          .sort()
      : [],
};

const { setup, labels } = loadConfig(root);
const { problems, unused } = checkAll({ setup, labels, src, checkupEnvironments: ENVIRONMENTS });

if (unused.length > 0)
  console.log(
    `ℹ️ 一覧にあってコードが使っていないラベル(人が手で付ける物なら、そのままでよい): ${unused.join("・")}`,
  );
if (problems.length > 0) {
  console.error(`❌ ${SETUP_FILE}・${LABELS_FILE} とコードがずれています: ${problems.length}件`);
  for (const p of problems) console.error(`- ${p}`);
  console.error("直し方: docs/guides/github-setup.md");
  process.exit(1);
}
console.log(
  `✅ ラベル ${labels.length}件・必須のチェック ${setup.ruleset.required_checks.length}件・Environment ${setup.environments.length}件・定期の見分け: ずれは無い`,
);

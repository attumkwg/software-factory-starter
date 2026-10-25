// 委託先の台帳とコードの照らし合わせ(CI)。中身は vendors-lib.mjs、テストは vendors.test.mjs。
//   pnpm vendors           台帳(docs/compliance/vendors.yaml)の書き方と、コードで使っている外の会社が台帳にあるかを見る。
//                          package.json の外のサービスの SDK / Terraform の提供者と資源の種類(AWS はサービスごと)/
//                          ワークフローの uses: / 人が読む一覧(vendors.md)の作り忘れ。どれかがあれば 1 で終わる
//   pnpm vendors --write   人が読む一覧 docs/compliance/vendors.md を作り直す
// 決まりは docs/designs/0017-vendors-ai-data-audit-trail.md・ADR 0030。
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "yaml";
import {
  actionsIn,
  checkLedger,
  checkUsage,
  dataClassesFrom,
  packagesIn,
  terraformIn,
  usageByVendor,
} from "./vendors-lib.mjs";
import { renderVendors } from "./vendors-render.mjs";

const LEDGER = "docs/compliance/vendors.yaml";
const LIST = "docs/compliance/vendors.md";
const read = (p) => readFileSync(p, "utf8").replaceAll("\r\n", "\n");

const listed = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
});
if (listed.status !== 0) {
  console.log("git ls-files が失敗した(git のリポジトリの中で動かす)");
  process.exit(1);
}
const files = listed.stdout.split("\0").filter((f) => f !== "");
const readable = (f) => {
  try {
    return { path: f, text: read(f) };
  } catch {
    return undefined; // 消したがまだ git に残っているファイルなど
  }
};
const pick = (test) => files.filter(test).map(readable).filter(Boolean);

const packageFiles = pick((f) => f === "package.json" || f.endsWith("/package.json")).map(
  ({ path, text }) => ({ path, json: JSON.parse(text) }),
);
const workflowFiles = pick(
  (f) =>
    (f.startsWith(".github/workflows/") && (f.endsWith(".yml") || f.endsWith(".yaml"))) ||
    (f.startsWith(".github/actions/") && (f.endsWith("/action.yml") || f.endsWith("/action.yaml"))),
);
const terraformFiles = pick((f) => f.startsWith("infra/") && f.endsWith(".tf"));

const ledger = parse(read(LEDGER));
const dataClasses = dataClassesFrom(read("apps/api/src/db/classification.ts"));
const found = {
  packages: packagesIn(packageFiles),
  actions: actionsIn(workflowFiles),
  terraform: terraformIn(terraformFiles),
};
const problems = [
  ...(dataClasses.length === 0 ? ["classification.ts から区分(DATA_CLASSES)が読めない"] : []),
  ...checkLedger(ledger, { dataClasses }),
  ...checkUsage(ledger, found),
];

const rendered = renderVendors(ledger, usageByVendor(ledger, found));
if (process.argv.includes("--write")) {
  writeFileSync(LIST, rendered);
  console.log(`${LIST} を作り直しました`);
} else {
  let current = "";
  try {
    current = read(LIST);
  } catch {
    // 無ければ下で作り忘れとして出す
  }
  if (current !== rendered) problems.push(`${LIST} が台帳とそろっていない(pnpm vendors --write)`);
}

console.log(
  `委託先 ${ledger.vendors?.length ?? 0}件を読みました。照らし合わせ: 依存 ${found.packages.length}件・Actions ${found.actions.length}件・Terraform の資源 ${found.terraform.types.length}件・提供者 ${found.terraform.sources.length}件`,
);
if (problems.length > 0) {
  console.log(`\n⚠️ 台帳の問題: ${problems.length}件`);
  for (const p of problems) console.log(`- ${p}`);
  console.log(
    "\n❌ 外の会社を足すなら vendors.yaml に1件(預け方・置き場所・区分・契約・認証・消え方)。人の確認が要る(危険度「高」)。",
  );
  process.exit(1);
}
console.log("✅ コードで使っている外の会社は、全部台帳にあります");

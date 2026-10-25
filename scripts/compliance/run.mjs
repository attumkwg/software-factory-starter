// 認証の準備(docs/compliance/)の確かめ。CI が流す。
//   pnpm compliance          管理策の一覧・規程・点検の台帳が指し合っているか・根拠のリンク切れ・SoA が古くないかを見る(落ちたら 1)
//   pnpm compliance --write  適用宣言書(docs/compliance/soa.md)を作り直す
// 設計: docs/designs/0019-evidence-soa-and-cost.md・使い方: docs/compliance/README.md
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { FILE as LEDGER_FILE, loadLedger } from "../checkup/todo.mjs";
import { EVIDENCE_NAMES } from "../evidence/sources.mjs";
import {
  CONTROLS_FILE,
  checkLinks,
  DIR,
  loadControls,
  loadPolicies,
  POLICIES_DIR,
  SOA_FILE,
  validateControls,
  validateLedgerRefs,
  validatePolicies,
} from "./lib.mjs";
import { renderSoa } from "./soa.mjs";

const root = process.cwd();
const exists = (p) => existsSync(join(root, p));
const read = (p) => (exists(p) ? readFileSync(join(root, p), "utf8") : undefined);
const mdFiles = (dir) =>
  readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".md"))
    .map((d) => relative(root, join(d.parentPath, d.name)).replaceAll("\\", "/"))
    .sort()
    .map((file) => ({ file, text: read(file) }));

const catalog = loadControls(read(CONTROLS_FILE));
const ledger = loadLedger(read(LEDGER_FILE));
const policies = loadPolicies(mdFiles(POLICIES_DIR));
const soa = renderSoa({ catalog, ledger, policies });

if (process.argv.includes("--write")) {
  writeFileSync(join(root, SOA_FILE), soa);
  console.log(`${SOA_FILE} を作り直しました`);
}

const controlIds = new Set((catalog?.controls ?? []).map((c) => c.id));
const problems = [
  ...validateControls(catalog, exists),
  ...validatePolicies(policies, controlIds),
  ...validateLedgerRefs(ledger, controlIds, EVIDENCE_NAMES, catalog),
  ...checkLinks(mdFiles(DIR), exists),
  ...(read(SOA_FILE) === soa
    ? []
    : [`${SOA_FILE} が古い(pnpm compliance --write で作り直す。手で直さない)`]),
];

if (problems.length > 0) {
  console.error(`❌ 認証の準備(${DIR})の問題: ${problems.length}件`);
  for (const p of problems) console.error(`- ${p}`);
  process.exit(1);
}
const applied = catalog.controls.filter((c) => c.applies).length;
console.log(
  `✅ 管理策 ${catalog.controls.length}件(適用 ${applied}件)・規程 ${policies.length}件・SoA は最新・リンク切れなし`,
);

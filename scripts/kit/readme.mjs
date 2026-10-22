// README の「使い始めたらやること」を、部品のカタログ(docs/kit/catalog.yaml)から作り直す。
//   pnpm kit:readme   印(<!-- kit:readme:start --> 〜 end)の間だけを書き換える
// 生成し忘れは `pnpm kit:catalog`(CI)が落とす。
import { readFileSync, writeFileSync } from "node:fs";
import { loadCatalog } from "./catalog-lib.mjs";
import { renderSection, replaceSection } from "./readme-lib.mjs";

const read = (p) => readFileSync(p, "utf8").replaceAll("\r\n", "\n");
const catalog = loadCatalog(read("docs/kit/catalog.yaml"));
const before = read("README.md");
const after = replaceSection(before, renderSection(catalog));
if (after === before) {
  console.log("README.md はカタログとそろっています");
} else {
  writeFileSync("README.md", after);
  console.log("README.md の「使い始めたらやること」を作り直しました");
}

// 部品のカタログ(docs/kit/catalog.yaml)の検査。CI で回す。
//   pnpm kit:catalog              書式・つながりの相手・消し方のパスの実在(「あり」だけ)・土台を消す答え・README の生成し忘れ
//   pnpm kit:catalog --show <id>  1つの部品を、頼っている/頼られている と一緒に出す(/tailor が使う)
// 考え方は docs/adr/0021-kit-catalog-and-tailoring.md。
import { existsSync, readFileSync } from "node:fs";
import {
  checkRemovedSet,
  dependentsOf,
  loadCatalog,
  readDecisions,
  validateCatalog,
} from "./catalog-lib.mjs";
import { END, renderSection, replaceSection, START } from "./readme-lib.mjs";

const CATALOG = "docs/kit/catalog.yaml";
const RECORD = "docs/product/tailoring.md";
const read = (p) => readFileSync(p, "utf8").replaceAll("\r\n", "\n");
const fsx = { exists: existsSync, read };
const catalog = loadCatalog(read(CATALOG));

const showAt = process.argv.indexOf("--show");
if (showAt > 0) {
  const id = process.argv[showAt + 1];
  const part = catalog.parts.find((p) => p.id === id);
  if (!part) {
    console.error(`部品 ${id} はカタログにありません`);
    process.exit(1);
  }
  console.log(JSON.stringify({ ...part, depended_by: dependentsOf(catalog, id) }, null, 2));
  process.exit(0);
}

const problems = validateCatalog(catalog, fsx);

// 記録があれば、消すと決めた部品が土台でないか・残す部品が頼っていないか
if (existsSync(RECORD)) {
  const ids = new Set(catalog.parts.map((p) => p.id));
  const { decisions, problems: recordProblems } = readDecisions(read(RECORD), ids);
  problems.push(...recordProblems.map((p) => `${RECORD}: ${p}`));
  const removed = new Set(catalog.parts.filter((p) => p.status === "消した").map((p) => p.id));
  for (const [id, d] of decisions) if (d === "消す") removed.add(id);
  const already = new Set(problems);
  for (const p of checkRemovedSet(catalog.parts, removed))
    if (!already.has(p)) problems.push(`${RECORD}: ${p}`);
}

// README の節が、カタログから作った物と同じか
const readme = read("README.md");
if (!readme.includes(START) || !readme.includes(END)) {
  problems.push(`README.md に ${START} と ${END} の印が無い`);
} else if (replaceSection(readme, renderSection(catalog)) !== readme) {
  problems.push("README.md の「使い始めたらやること」が古い。`pnpm kit:readme` で作り直す");
}

if (problems.length > 0) {
  console.error(`部品のカタログに問題があります(${CATALOG}):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
const count = (s) => catalog.parts.filter((p) => p.status === s).length;
console.log(
  `部品のカタログは正しい形です: ${catalog.parts.length} 件(あり ${count("あり")}・作成中 ${count("作成中")}・未 ${count("未")}・消した ${count("消した")})`,
);

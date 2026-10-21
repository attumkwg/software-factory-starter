// 確かめるための試作(prototypes/<賭けの ID>-<短い名前>/)。決まりは docs/guides/prototypes.md。
//   pnpm prototypes             本物と混ぜていないかを確かめる(CI)。本物の API・DB・AWS・秘密を読む・
//                               noindex が無い・賭けのファイルが無い ときは 1 で終わる。
//                               賭けが終わった(dropped / adopted / retired)のにフォルダが残っていたら知らせるだけ
//   pnpm prototype:dev <ID>     手元で開く(AWS が無くても見せられる。http://localhost:5180/<ID>/)
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { checkPrototype, idOfDir, stageOf } from "./prototypes-lib.mjs";

const DIR = "prototypes";
const BETS = "docs/product/bets";
// 読むのはコードと設定だけ(dist・node_modules は見ない)
const SKIP = new Set(["node_modules", "dist"]);
const CODE = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".html", ".css"];

const dirs = () =>
  existsSync(DIR)
    ? readdirSync(DIR)
        .filter((d) => statSync(join(DIR, d)).isDirectory())
        .sort()
    : [];

const walk = (root, at = root, out = {}) => {
  for (const name of readdirSync(at)) {
    if (SKIP.has(name)) continue;
    const path = join(at, name);
    const rel = relative(root, path).split("\\").join("/");
    if (statSync(path).isDirectory()) walk(root, path, out);
    else if (name.startsWith(".env") || CODE.some((ext) => name.endsWith(ext)))
      out[rel] = readFileSync(path, "utf8");
  }
  return out;
};

const betOf = (id) => {
  if (!id || !existsSync(BETS)) return {};
  const file = readdirSync(BETS).find((f) => f.startsWith(`${id}-`) && f.endsWith(".md"));
  return file ? { betFile: file, betStage: stageOf(readFileSync(join(BETS, file), "utf8")) } : {};
};

const checkOne = (dir) => {
  const files = walk(join(DIR, dir));
  const pkg = JSON.parse(files["package.json"] ?? "{}");
  return checkPrototype({ dir, pkg, html: files["index.html"], files, ...betOf(idOfDir(dir)) });
};

const mark = (r) => {
  if (r.problems.length > 0) return "⚠️";
  return r.warnings.length > 0 ? "🧹" : "・";
};

const check = () => {
  const problems = [];
  const warnings = [];
  const list = dirs();
  console.log(`試作 ${list.length}件を読みました(${DIR}/)`);
  for (const dir of list) {
    const result = checkOne(dir);
    console.log(`${mark(result)} ${dir}`);
    for (const p of result.problems) problems.push(`${DIR}/${dir} ${p}`);
    for (const w of result.warnings) warnings.push(`${DIR}/${dir} ${w}`);
  }
  // 落とさずに知らせる(GitHub Actions では PR の画面にも出る書き方)
  for (const w of warnings) console.log(`::warning::🧹 ${w}`);
  if (problems.length > 0) {
    console.log(`\n⚠️ 本物と混ぜない決まりに合わない所: ${problems.length}件`);
    for (const p of problems) console.log(`- ${p}`);
    console.log("\n❌ 直してください(docs/guides/prototypes.md)。");
    process.exit(1);
  }
};

const dev = () => {
  const id = process.argv[3] ?? "";
  const dir = dirs().find((d) => idOfDir(d) === id);
  if (!dir) {
    console.log(`試作 ${id || "(ID が空)"} が ${DIR}/ に無い。例: pnpm prototype:dev B-0002`);
    process.exit(1);
  }
  console.log(`開く: http://localhost:5180/${id}/(止めるときは Ctrl+C)`);
  const run = spawnSync("pnpm", ["--filter", `./${DIR}/${dir}`, "dev"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  process.exit(run.status ?? 1);
};

if (process.argv[2] === "dev") dev();
else check();

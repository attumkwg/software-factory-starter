// 依存のライセンスの一覧(CI)。中身は licenses-lib.mjs・licenses-render.mjs、テストは licenses.test.mjs。
//   pnpm deps:licenses                 入っている依存のライセンスを決まり(docs/compliance/licenses.yaml)と照らし合わせる。
//                                      入れないライセンス(GPL・AGPL など)/ 決まりに無いライセンス / 注意なのに review に無い /
//                                      review の古さ / 人が読む一覧(licenses.md)の作り忘れ。どれかがあれば 1 で終わる
//   pnpm deps:licenses --write         人が読む一覧 docs/compliance/licenses.md を作り直す
//   pnpm deps:licenses --full a.csv    版つきの全部の一覧を CSV で書く(DD・審査・弁護士に渡す。コミットしない)
// 先に pnpm install が要る(node_modules から読む)。決まりは ADR 0083。
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import {
  byName,
  checkPolicy,
  directDeps,
  packagesFrom,
  withoutPlatformBinaries,
} from "./licenses-lib.mjs";
import { renderFullCsv, renderLicenses } from "./licenses-render.mjs";

const POLICY = "docs/compliance/licenses.yaml";
const LIST = "docs/compliance/licenses.md";
const read = (p) => readFileSync(p, "utf8").replaceAll("\r\n", "\n");

// 引数は決まった文字だけなので、1本の文字列で shell に渡す(Windows の pnpm.cmd を動かすため)
const pnpm = (args) =>
  spawnSync(`pnpm ${args.join(" ")}`, {
    encoding: "utf8",
    shell: true,
    maxBuffer: 64 * 1024 * 1024,
  });

const pnpmLicenses = (extra) => {
  const run = pnpm(["licenses", "list", "--json", "--recursive", ...extra]);
  if (run.status !== 0) {
    console.log(`pnpm licenses list が失敗した(先に pnpm install)\n${run.stderr}`);
    process.exit(1);
  }
  return packagesFrom(JSON.parse(run.stdout));
};

const manifestOf = (path) => {
  try {
    return JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
  } catch {
    return undefined;
  }
};

const listed = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
});
if (listed.status !== 0) {
  console.log("git ls-files が失敗した(git のリポジトリの中で動かす)");
  process.exit(1);
}
const manifests = listed.stdout
  .split("\0")
  .filter(
    (f) => (f === "package.json" || f.endsWith("/package.json")) && !f.includes("node_modules/"),
  )
  .flatMap((path) => {
    try {
      return [{ path, json: JSON.parse(read(path)) }];
    } catch {
      return []; // 消したがまだ git に残っているファイルなど
    }
  });

const policy = parse(read(POLICY));
const all = pnpmLicenses([]);
const prod = new Set(pnpmLicenses(["--prod"]).map((p) => p.name));
const fullAt = process.argv.indexOf("--full");
if (fullAt !== -1) {
  const out = process.argv[fullAt + 1];
  if (!out) {
    console.log("--full の後に書き出すファイルの名前を(例: --full licenses-full.csv)");
    process.exit(1);
  }
  writeFileSync(out, renderFullCsv({ packages: all, prod, policy }));
  console.log(`${out} に ${all.length}件(名前ごと)を書きました`);
}

const packages = byName(withoutPlatformBinaries(all, manifestOf));
const problems = checkPolicy(packages, policy);
const rendered = renderLicenses({ packages, prod, direct: directDeps(manifests), policy });
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
  if (current !== rendered)
    problems.push(`${LIST} が依存とそろっていない(pnpm deps:licenses --write)`);
}

console.log(
  `依存 ${packages.length}件(名前ごと。うち本番 ${packages.filter((p) => prod.has(p.name)).length}件)を決まりと照らし合わせました`,
);
if (problems.length > 0) {
  console.log(`\n直す所が ${problems.length}件あります:`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log("入れないライセンスはありません。一覧も今の姿です");

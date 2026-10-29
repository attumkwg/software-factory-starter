// 番号の範囲(docs/kit/numbering.yaml)と、番号つきの記録を読む・書く所。中身(判定)は adr-lib.mjs。
// pnpm adr と pnpm checkup:adopt が使う。決まり: docs/specs/0091-own-number-range.md
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkNumbersInRange, checkRange, parseRange, withOwnFrom } from "./adr-lib.mjs";

export const RANGE_FILE = "docs/kit/numbering.yaml";
export const DIRS = { adr: "docs/adr", specs: "docs/specs", designs: "docs/designs" };

export const loadRange = () => parseRange(readFileSync(RANGE_FILE, "utf8"));

const readDir = (dir, withFirstLine) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    .sort()
    .map((file) =>
      withFirstLine
        ? { file, firstLine: readFileSync(join(dir, file), "utf8").split("\n")[0].trim() }
        : { file },
    );

// { adrs: [{ file, firstLine }], specs: [{ file }], designs: [{ file }] }
export const loadNumberedDocs = () => ({
  adrs: readDir(DIRS.adr, true),
  specs: readDir(DIRS.specs, false),
  designs: readDir(DIRS.designs, false),
});

// 範囲の設定と、3つのフォルダの番号が範囲の中にあるか
export const rangeProblems = (range, docs) => {
  const config = checkRange(range);
  if (config.length > 0) return config.map((p) => `${RANGE_FILE} ${p}`);
  return [
    ...checkNumbersInRange(DIRS.adr, docs.adrs, range),
    ...checkNumbersInRange(DIRS.specs, docs.specs, range),
    ...checkNumbersInRange(DIRS.designs, docs.designs, range),
  ];
};

// 自分の範囲の始まりを決める。書くと範囲が壊れるときは書かずに問題を返す
export const decideOwnFrom = (value) => {
  const range = loadRange();
  const ownFrom = value === undefined ? (range.ownFrom ?? range.kitUntil + 1) : Number(value);
  const next = { ...range, ownFrom };
  const problems = rangeProblems(next, loadNumberedDocs());
  if (problems.length > 0) return { ownFrom, problems };
  if (ownFrom !== range.ownFrom) {
    writeFileSync(RANGE_FILE, withOwnFrom(readFileSync(RANGE_FILE, "utf8"), ownFrom));
  }
  return { ownFrom, problems: [] };
};

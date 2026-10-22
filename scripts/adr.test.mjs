// pnpm adr の中身(adr-lib.mjs)のテスト。node --test scripts/adr.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAdrs, nextNumber, numberOfFile } from "./adr-lib.mjs";

const adr = (file, title = "決めたこと") => ({
  file,
  firstLine: `# ADR ${file.slice(0, 4)}: ${title}`,
});

test("ファイル名から番号を取り出す", () => {
  assert.equal(numberOfFile("0016-concurrent-index-migrations.md"), "0016");
  assert.equal(numberOfFile("016-short.md"), undefined);
  assert.equal(numberOfFile("0016.md"), undefined);
  assert.equal(numberOfFile("0016-.md"), undefined);
  assert.equal(numberOfFile("abcd-name.md"), undefined);
});

test("番号がそろっていれば問題なし。_template.md は見ない", () => {
  const files = [
    adr("0001-a.md"),
    adr("0002-b.md"),
    { file: "_template.md", firstLine: "# ADR NNNN: <決めたことを一言で>" },
  ];
  assert.deepEqual(checkAdrs(files), []);
});

test("同じ番号が2つあれば落とす(2026-10-22 の 0016 の重なり)", () => {
  const problems = checkAdrs([
    adr("0016-concurrent-index-migrations.md"),
    adr("0016-reauth-token-in-encrypted-cookie.md"),
  ]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /0016-reauth-token-in-encrypted-cookie\.md 番号 0016 が/);
});

test("見出しの番号がファイル名と違えば落とす", () => {
  const problems = checkAdrs([{ file: "0023-reauth.md", firstLine: "# ADR 0016: 確かめ直しの札" }]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /# ADR 0023: /);
});

test("4桁の番号で始まらないファイル名は落とす", () => {
  const problems = checkAdrs([{ file: "reauth.md", firstLine: "# ADR 0001: x" }]);
  assert.equal(problems.length, 1);
});

test("次の番号は一番大きい番号の次", () => {
  assert.equal(nextNumber([adr("0001-a.md"), adr("0022-b.md"), adr("0016-c.md")]), "0023");
  assert.equal(nextNumber([]), "0001");
});

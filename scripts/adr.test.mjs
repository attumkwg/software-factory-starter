// pnpm adr の中身(adr-lib.mjs)のテスト。node --test scripts/adr.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkAdrs,
  checkNumberedDocs,
  nextDocNumber,
  nextNumber,
  numberOfFile,
} from "./adr-lib.mjs";

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

const doc = (file) => ({ file });

test("仕様・設計書: 同じフォルダで番号が重なれば落とす(2026-10-22 の 0008 の重なり)", () => {
  const problems = checkNumberedDocs("docs/specs", [
    doc("0008-personal-data.md"),
    doc("0008-web-noindex-mobile.md"),
    doc("_template.md"),
  ]);
  assert.equal(problems.length, 1);
  assert.ok(
    problems[0].startsWith(
      "docs/specs/0008-web-noindex-mobile.md 番号 0008 が docs/specs/0008-personal-data.md と",
    ),
  );
});

test("仕様と設計書が同じ番号で対になるのは正しい", () => {
  assert.deepEqual(checkNumberedDocs("docs/specs", [doc("0001-tasks.md"), doc("0002-a.md")]), []);
  assert.deepEqual(checkNumberedDocs("docs/designs", [doc("0001-tasks.md"), doc("0002-a.md")]), []);
});

test("仕様・設計書: 4桁の番号で始まらないファイル名は落とす", () => {
  const problems = checkNumberedDocs("docs/designs", [doc("tasks.md")]);
  assert.equal(problems.length, 1);
});

test("仕様と設計書の次の番号は、2つのフォルダ全部の最大の次", () => {
  assert.equal(nextDocNumber([doc("0014-a.md")], [doc("0013-a.md"), doc("0015-b.md")]), "0016");
  assert.equal(nextDocNumber([], []), "0001");
});

// pnpm adr の中身(adr-lib.mjs)のテスト。node --test scripts/adr.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  checkAdrs,
  checkNumberedDocs,
  checkNumbersInRange,
  checkRange,
  nextDocNumber,
  nextInRange,
  nextNumber,
  numberOfFile,
  parseRange,
  withOwnFrom,
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

// ── 番号の範囲(G-116・仕様 0091)──
const KIT = { kitUntil: 4999, ownFrom: null };
const OWN = { kitUntil: 4999, ownFrom: 5000 };

test("範囲: 自分の範囲がキットの範囲と重なれば落とす", () => {
  assert.deepEqual(checkRange(KIT), []);
  assert.deepEqual(checkRange(OWN), []);
  assert.deepEqual(checkRange({ kitUntil: 4999, ownFrom: 6000 }), []);
  assert.match(checkRange({ kitUntil: 4999, ownFrom: 4999 })[0], /重なる/);
  assert.match(checkRange({ kitUntil: 4999, ownFrom: 100 })[0], /重なる/);
});

test("範囲: 4桁に収まらない・整数でない設定は落とす", () => {
  assert.equal(checkRange({ kitUntil: undefined, ownFrom: null }).length, 1);
  assert.equal(checkRange({ kitUntil: 4999, ownFrom: 10000 }).length, 1);
  assert.equal(checkRange({ kitUntil: 4999, ownFrom: Number("abc") }).length, 1);
  assert.equal(checkRange({ kitUntil: 4999, ownFrom: 5000.5 }).length, 1);
});

test("範囲: キットの中(own_from が null)で、キットの範囲を越えた番号は落とす", () => {
  assert.deepEqual(checkNumbersInRange("docs/specs", [doc("4999-a.md")], KIT), []);
  const problems = checkNumbersInRange("docs/specs", [doc("4999-a.md"), doc("5000-b.md")], KIT);
  assert.equal(problems.length, 1);
  assert.ok(problems[0].startsWith("docs/specs/5000-b.md 番号 5000 がキットの範囲"));
});

test("範囲: 使う側では、キットの範囲と自分の範囲の間の番号を落とす", () => {
  const range = { kitUntil: 4999, ownFrom: 6000 };
  const files = [doc("0059-kit.md"), doc("5500-gap.md"), doc("6000-own.md")];
  const problems = checkNumbersInRange("docs/designs", files, range);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /5500-gap\.md 番号 5500 はキットの範囲/);
  assert.deepEqual(checkNumbersInRange("docs/designs", files.slice(0, 1), OWN), []);
});

test("範囲: 次の番号は自分の範囲の中(キットの記録がいくつあっても)", () => {
  const kitDocs = [doc("0001-a.md"), doc("0087-b.md")];
  assert.equal(nextInRange(kitDocs, KIT), "0088");
  assert.equal(nextInRange(kitDocs), "0088");
  assert.equal(nextInRange(kitDocs, OWN), "5000");
  assert.equal(nextInRange([...kitDocs, doc("5000-c.md"), doc("5003-d.md")], OWN), "5004");
});

test("範囲: キットの 0059 を取り込んでも、自分の記録とは重ならない(12-4)", () => {
  const own = [doc("5000-mine.md"), doc("5001-mine2.md")];
  const merged = [...own, doc("0059-high-risk-approvals.md")];
  assert.deepEqual(checkNumberedDocs("docs/specs", merged), []);
  assert.deepEqual(checkNumbersInRange("docs/specs", merged, OWN), []);
  assert.equal(nextInRange(merged, OWN), "5002");
});

test("範囲の設定を読み、own_from だけを書き換える(コメントは残す)", () => {
  const text = "# 範囲\nkit_until: 4999 # キット\nown_from: null\n";
  assert.deepEqual(parseRange(text), KIT);
  const after = withOwnFrom(text, 5000);
  assert.deepEqual(parseRange(after), OWN);
  assert.ok(after.startsWith("# 範囲\n"));
  assert.match(after, /kit_until: 4999 # キット/);
  assert.deepEqual(parseRange(""), { kitUntil: undefined, ownFrom: null });
});

test("本物の docs/kit/numbering.yaml: キットの中は own_from が null で、範囲の設定が正しい", () => {
  const range = parseRange(readFileSync("docs/kit/numbering.yaml", "utf8"));
  assert.equal(range.ownFrom, null);
  assert.deepEqual(checkRange(range), []);
});

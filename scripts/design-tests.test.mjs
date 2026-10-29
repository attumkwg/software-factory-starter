// pnpm design-tests の中身(design-tests-lib.mjs)のテスト。node --test scripts/design-tests.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkDesign,
  designFiles,
  designState,
  needsCheck,
  requirementRows,
  testPaths,
} from "./design-tests-lib.mjs";

const design = (state, ...rows) =>
  [
    "# 設計: 例",
    "",
    `> 状態: ${state}`,
    "",
    "## 7. 要求との対応",
    "",
    "> 受け入れ条件の1つずつに、設計とテストがそろっているか。",
    "",
    "| 受け入れ条件(仕様) | 設計のどこ | テスト |",
    "|---|---|---|",
    ...rows,
    "",
    "## 8. 非機能",
    "",
    "| 表 | テスト |",
    "|---|---|",
    "| 7 の外の表は見ない | なし |",
  ].join("\n");

const API_ROW =
  "| 管理者が止めると届かない | 3. API | `apps/api/test/integration/task-mail.int.test.ts` |";
const WEB_ROW =
  "| 管理者でない人には操作が出ない | 画面 | `authz-matrix`(3行)/ 子3 画面の単体テスト |";
const all = () => true;
const none = () => false;

test("パスに数えるのは「/」と拡張子のある物だけ(通り名・ファイル名だけは数えない)", () => {
  assert.deepEqual(
    testPaths(
      "子1 `test/integration/task-mail.int.test.ts`(止める)/ `mail.int.test.ts`・`audit-coverage`・`pnpm gaps`・`apps/web/src/`",
    ),
    ["test/integration/task-mail.int.test.ts"],
  );
  assert.deepEqual(testPaths("子3 画面の単体テスト"), []);
});

test("表の行を読む(7 の節の中だけ・区切りの行は飛ばす・行の番号つき)", () => {
  const read = requirementRows(design("下書き", API_ROW, WEB_ROW));
  assert.deepEqual(
    read.rows.map((row) => [row.line, row.condition, row.paths.length]),
    [
      [11, "管理者が止めると届かない", 1],
      [12, "管理者でない人には操作が出ない", 0],
    ],
  );
});

test("節・表・「テスト」の列が無ければ落とす", () => {
  assert.match(checkDesign("# 設計\n\n## 8. 非機能\n", all).problems[0], /節が無い/);
  assert.match(
    checkDesign("## 7. 要求との対応\n\nまだ書いていない\n", all).problems[0],
    /表が無い/,
  );
  assert.match(
    checkDesign("## 7. 要求との対応\n\n| 条件 | 確かめ |\n|---|---|\n| a | `b/c.ts` |\n", all)
      .problems[0],
    /「テスト」の列が無い/,
  );
  assert.match(checkDesign(design("下書き"), all).problems[0], /行が無い/);
});

test("テストの欄にファイルのパスが無い行は落とす(「子3 画面の単体テスト」の形)", () => {
  const { problems } = checkDesign(design("下書き", API_ROW, WEB_ROW), all);
  assert.equal(problems.length, 1);
  assert.match(
    problems[0],
    /^12行目「管理者でない人には操作が出ない」: テストの欄にファイルのパスが無い/,
  );
});

test("書いたファイルが無いとき: 「完了」なら落とし、それより前は出すだけ(設計は実装より先に入る)", () => {
  const draft = checkDesign(design("承認済み(承認した人: @a)", API_ROW), none);
  assert.deepEqual(draft.problems, []);
  assert.match(draft.waiting[0], /task-mail\.int\.test\.ts` はまだ無い/);
  const done = checkDesign(design("完了", API_ROW), none);
  assert.ok(done.problems[0]?.includes("task-mail.int.test.ts` が無い(状態は「完了」"));
  assert.deepEqual(checkDesign(design("完了", API_ROW), all), { problems: [], waiting: [] });
});

test("CRLF でも同じに読む", () => {
  const { problems } = checkDesign(design("完了", API_ROW, WEB_ROW).replaceAll("\n", "\r\n"), all);
  assert.equal(problems.length, 1);
  assert.equal(designState("> 状態: 完了\r\n"), "完了");
});

test("見る設計書: docs/designs の直下の .md だけ(ひな形・README は見ない)", () => {
  assert.deepEqual(
    designFiles([
      "docs/designs/0093-design-test-paths.md",
      "docs/designs/_template.md",
      "docs/designs/README.md",
      "docs/designs/old/0001-x.md",
      "docs/specs/0097-design-test-paths.md",
      "scripts/design-tests.mjs",
    ]),
    ["docs/designs/0093-design-test-paths.md"],
  );
});

test("見るのは新しい設計書・7 の節か状態を変えた物だけ(文の直しだけなら見ない)", () => {
  const old = design("承認済み", WEB_ROW);
  assert.equal(needsCheck(null, old), true);
  assert.equal(needsCheck(old, old.replace("# 設計: 例", "# 設計: 例(名前を直した)")), false);
  assert.equal(needsCheck(old, old.replace("画面の単体テスト", "`apps/web/src/x.test.tsx`")), true);
  assert.equal(needsCheck(old, old.replace("> 状態: 承認済み", "> 状態: 完了")), true);
});

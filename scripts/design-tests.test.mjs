// pnpm design-tests の中身(design-tests-lib.mjs)のテスト。node --test scripts/design-tests.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  baseStatus,
  checkDesign,
  designFiles,
  manualReason,
  needsCheck,
  pathRoots,
  requirementRows,
  selectDesigns,
  specOf,
  splitZ,
  stateWord,
  testPaths,
} from "./design-tests-lib.mjs";

const SPEC = "> 仕様: [docs/specs/0097-x.md](../specs/0097-x.md)・ADR [0094](../adr/0094-a.md)";
const design = (state, ...rows) =>
  [
    "# 設計: 例",
    "",
    SPEC,
    `> 状態: ${state}`,
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
const all = { exists: () => true };
const none = { exists: () => false };

test("パスに数えるのはテストのファイル(名前に .test. か .spec.)だけ", () => {
  assert.deepEqual(
    testPaths(
      "子1 `test/integration/task-mail.int.test.ts`(止める)/ `mail.int.test.ts`・`audit-coverage`・`pnpm gaps`・`scripts/design-tests.mjs`・`apps/web/e2e/a.spec.ts`",
    ),
    ["test/integration/task-mail.int.test.ts", "apps/web/e2e/a.spec.ts"],
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

test("節・表・「テスト」の列・行が無ければ落とす", () => {
  const first = (text) => checkDesign(text, all).problems[0];
  assert.match(first("# 設計\n\n## 8. 非機能\n"), /節が無い/);
  assert.match(first("## 7. 要求との対応\n\nまだ書いていない\n"), /表が無い/);
  assert.match(
    first("## 7. 要求との対応\n\n| 条件 | 確かめ |\n|---|---|\n| a | `b/c.test.ts` |\n"),
    /「テスト」の列が無い/,
  );
  assert.match(first(design("下書き")), /行が無い/);
});

test("テストのパスが無い行は落とす(「子3 画面の単体テスト」の形)", () => {
  const { problems } = checkDesign(design("下書き", API_ROW, WEB_ROW), all);
  assert.equal(problems.length, 1);
  assert.ok(problems[0]?.startsWith("12行目「管理者でない人には操作が出ない」: テストの欄に"));
});

test("「(手で確かめる: 理由)」の行は落とさずに出す。理由が空なら落とす", () => {
  const row = "| 手順書に書いた | 6 | (手で確かめる: 文書の中身。レビューで読む) |";
  assert.equal(manualReason(row), "文書の中身。レビューで読む");
  const ok = checkDesign(design("完了", row), all);
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.manual, [
    "11行目「手順書に書いた」: 手で確かめる(文書の中身。レビューで読む)",
  ]);
  assert.equal(checkDesign(design("完了", "| a | 6 | (手で確かめる: ) |"), all).problems.length, 1);
});

test("書いたファイルが無いとき: 設計書か仕様が「完了」なら落とし、それより前は出すだけ", () => {
  const draft = checkDesign(design("承認済み(承認した人: @a)", API_ROW), none);
  assert.deepEqual(draft.problems, []);
  assert.match(draft.waiting[0], /task-mail\.int\.test\.ts` はまだ無い/);
  assert.equal(checkDesign(design("完了", API_ROW), none).problems.length, 1);
  // 設計書は承認済みのままでも、指す仕様が完了なら見る
  const bySpec = checkDesign(design("承認済み", API_ROW), { ...none, specState: "完了" });
  assert.ok(
    bySpec.problems[0]?.includes("task-mail.int.test.ts` が無い(設計書か仕様の状態が「完了」"),
  );
  assert.deepEqual(checkDesign(design("完了", API_ROW), all), {
    problems: [],
    waiting: [],
    manual: [],
  });
});

test("リポジトリの外を指すパスは落とす", () => {
  const row = (p) => `| a | 3 | \`${p}\` |`;
  assert.equal(checkDesign(design("下書き", row("/etc/x.test.ts")), all).problems.length, 1);
  assert.equal(checkDesign(design("下書き", row("apps/../../x.test.ts")), all).problems.length, 1);
});

test("状態は頭の言葉だけを読む。新しい設計書で読めなければ落とす", () => {
  assert.equal(stateWord("> 状態: 承認済み(承認した人: @a 2026-10-29)\n"), "承認済み");
  assert.equal(stateWord("> 状態: 完了(実装済み)"), "完了");
  assert.equal(stateWord("> 状態：完了"), ""); // 全角の「：」
  assert.equal(stateWord("> 状態: できた"), "");
  const broken = design("完了", API_ROW).replace("> 状態: 完了", "> 状態：完了");
  assert.equal(checkDesign(broken, { ...all, isNew: true }).problems.length, 1);
  assert.equal(checkDesign(broken, all).problems.length, 0); // 昔の設計書は今のまま
});

test("CRLF でも同じに読む", () => {
  const { problems } = checkDesign(design("完了", API_ROW, WEB_ROW).replaceAll("\n", "\r\n"), all);
  assert.equal(problems.length, 1);
});

test("指す仕様は「> 仕様:」の最初のリンク", () => {
  assert.equal(specOf(SPEC), "docs/specs/0097-x.md");
  assert.equal(specOf("> 仕様: まだ無い"), "");
});

test("見る設計書: docs/designs の直下の .md だけ(ひな形・README は見ない)", () => {
  assert.deepEqual(
    designFiles([
      "docs/designs/0097-design-test-paths.md",
      "docs/designs/_template.md",
      "docs/designs/README.md",
      "docs/designs/old/0001-x.md",
      "docs/specs/0097-design-test-paths.md",
      "scripts/design-tests.mjs",
    ]),
    ["docs/designs/0097-design-test-paths.md"],
  );
  assert.deepEqual(splitZ("docs/designs/a b.md\0docs/specs/c.md\0"), [
    "docs/designs/a b.md",
    "docs/specs/c.md",
  ]);
});

test("見るのは新しい設計書・7 の節か状態の頭の言葉を変えた物だけ(文の直しだけなら見ない)", () => {
  const old = design("承認済み(承認した人: @a)", WEB_ROW);
  assert.equal(needsCheck(null, old), true);
  assert.equal(needsCheck(old, old.replace("# 設計: 例", "# 設計: 例(名前を直した)")), false);
  assert.equal(needsCheck(old, old.replace("(承認した人: @a)", "(承認した人: @b)")), false);
  assert.equal(needsCheck(old, old.replace("画面の単体テスト", "`apps/web/src/x.test.tsx`")), true);
  assert.equal(needsCheck(old, old.replace("> 状態: 承認済み", "> 状態: 完了")), true);
});

test("選ぶ: 変えた設計書と、この PR で「完了」にした仕様を指す設計書", () => {
  const d = "docs/designs/0089-a.md";
  const other = "docs/designs/0090-b.md";
  const text = design("承認済み", API_ROW);
  const spec = (state) => `# 仕様\n\n> 状態: ${state}\n`;
  const changes = [
    { file: "docs/specs/0097-x.md", before: spec("承認済み"), after: spec("完了(実装済み)") },
    { file: "docs/designs/0091-c.md", before: null, after: text },
  ];
  const designs = [
    { file: d, text },
    { file: other, text: text.replaceAll("0097-x", "0001-y") },
  ];
  assert.deepEqual(selectDesigns(changes, designs), [
    { file: d, isNew: false },
    { file: "docs/designs/0091-c.md", isNew: true },
  ]);
  // もう完了だった仕様の文を直しただけなら、指す設計書は見ない
  const edit = [
    { file: "docs/specs/0097-x.md", before: spec("完了"), after: `${spec("完了")}直した\n` },
  ];
  assert.deepEqual(selectDesigns(edit, designs), []);
});

test("比べる元: 読めれば見る・最初のコミットなら見ずに通す・浅い checkout なら落とす", () => {
  const base = "HEAD^1";
  assert.deepEqual(baseStatus({ base, resolved: true, hasParent: true, shallow: true }), {
    ok: true,
  });
  assert.match(
    baseStatus({ base, resolved: false, hasParent: false, shallow: false }).skip,
    /比べる元が無い/,
  );
  assert.match(
    baseStatus({ base, resolved: false, hasParent: false, shallow: true }).error,
    /fetch-depth/,
  );
  assert.match(
    baseStatus({ base: "origin/main", resolved: false, hasParent: true, shallow: false }).error,
    /git fetch/,
  );
});

test("パスを探す場所: 根と各パッケージの中", () => {
  assert.deepEqual(pathRoots({ apps: ["api", "web"], packages: ["ui"] }), [
    "",
    "apps/api/",
    "apps/web/",
    "packages/ui/",
  ]);
});

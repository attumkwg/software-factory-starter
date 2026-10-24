import assert from "node:assert/strict";
import { test } from "node:test";
import { needsHeavy } from "./ci-scope.mjs";

test("文書だけなら重い検査を省く", () => {
  assert.equal(needsHeavy(["docs/guides/ci-speed.md"]), false);
  assert.equal(needsHeavy(["README.md", "CLAUDE.md", ".claude/skills/bet/SKILL.md"]), false);
  // 点検の台帳・カタログ(読むのは速い検査の scripts だけ)
  assert.equal(needsHeavy(["docs/checkup/todo.yaml", "docs/checkup/README.md"]), false);
  assert.equal(needsHeavy(["docs/kit/catalog.yaml"]), false);
});

test("文書の外を1つでも変えたら流す", () => {
  assert.equal(needsHeavy(["docs/guides/ci-speed.md", "apps/api/src/app.ts"]), true);
  assert.equal(needsHeavy(["package.json"]), true);
  assert.equal(needsHeavy(["docker-compose.yml"]), true);
  assert.equal(needsHeavy([".github/workflows/ci.yml"]), true);
});

test("重い検査が読む文書は流す", () => {
  // 結合テストが全行を叩く権限の表
  assert.equal(needsHeavy(["docs/authz/matrix.yaml"]), true);
  // 画面のビルドが取り込む規約の本文・パッケージの中の文書
  assert.equal(needsHeavy(["apps/web/src/legal/terms/2026-10-01.md"]), true);
  assert.equal(needsHeavy(["packages/shared/README.md"]), true);
});

test("差分が空なら流す(取れなかったときと同じに扱う)", () => {
  assert.equal(needsHeavy([]), true);
});

test("場所で丸ごと文書とみなすのは docs/ だけ(ほかは .md かどうか)", () => {
  assert.equal(needsHeavy(["docsx/a.md"]), false);
  assert.equal(needsHeavy(["docsx/a.ts"]), true);
  assert.equal(needsHeavy(["docs.ts"]), true);
  assert.equal(needsHeavy(["apps/docs/a.md"]), true);
});

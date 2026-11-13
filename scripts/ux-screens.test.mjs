// 🎨 に渡す画面の画像の選び方(仕様 0099)。node --test scripts/ux-screens.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { planShots, shotOf, touchesScreens } from "./ux-screens-lib.mjs";

const D = "apps/web/e2e/vrt/__screenshots__";

test("VRT の基準の画像の道から、幅と画面を読む", () => {
  assert.deepEqual(shotOf(`${D}/mobile/tasks.png`), { width: "mobile", screen: "tasks" });
  assert.equal(shotOf(`${D}/tasks.png`), null);
  assert.equal(shotOf("apps/web/src/pages/TasksPage.tsx"), null);
  assert.equal(shotOf(`${D}/mobile/tasks.txt`), null);
});

test("画面を変える PR か(テストだけの変更は入れない)", () => {
  assert.equal(touchesScreens(["apps/web/src/pages/TasksPage.tsx"]), true);
  assert.equal(touchesScreens(["packages/ui/src/styles.css"]), true);
  assert.equal(touchesScreens(["apps/site/src/index.astro"]), true);
  assert.equal(touchesScreens(["apps/web/src/pages/TasksPage.test.tsx"]), false);
  assert.equal(touchesScreens(["apps/api/src/app.ts", "docs/README.md"]), false);
});

test("変わった画像があれば、変わる前と後の組にする(新しい画面は後だけ)", () => {
  const changed = [
    `${D}/desktop/tasks.png`,
    `${D}/mobile/new-screen.png`,
    "apps/web/src/pages/TasksPage.tsx",
  ];
  const head = [`${D}/desktop/tasks.png`, `${D}/mobile/new-screen.png`, `${D}/desktop/login.png`];
  const { changedShots, files } = planShots(changed, head);
  assert.equal(changedShots, true);
  assert.deepEqual(
    files.map((f) => f.name),
    [
      "before-desktop-tasks.png",
      "after-desktop-tasks.png",
      "before-mobile-new-screen.png",
      "after-mobile-new-screen.png",
    ],
  );
});

test("消した画面は変わる前だけ", () => {
  const { files } = planShots([`${D}/desktop/old.png`], []);
  assert.deepEqual(
    files.map((f) => f.name),
    ["before-desktop-old.png"],
  );
});

test("変わった画像が無ければ、PR の版の画像を全部「後」で出す", () => {
  const head = [`${D}/desktop/login.png`, `${D}/mobile/login.png`];
  const { changedShots, files } = planShots(["apps/web/src/pages/LoginPage.tsx"], head);
  assert.equal(changedShots, false);
  assert.deepEqual(
    files.map((f) => f.name),
    ["after-desktop-login.png", "after-mobile-login.png"],
  );
});

test("🎨 を呼ぶ道は、台帳の 🎨 の「呼ぶ PR」と同じ", () => {
  const ledger = readFileSync("docs/review-viewpoints.md", "utf8");
  const row = ledger.split("\n").find((l) => l.startsWith("| 🎨"));
  assert.ok(row, "台帳に 🎨 の行が無い");
  for (const p of ["apps/web/src", "packages/ui", "apps/site"])
    assert.ok(row.includes(p), `台帳の 🎨 に ${p} が無い`);
});

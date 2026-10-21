// node --test scripts/prototypes.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkDeps,
  checkPrototype,
  checkSource,
  deniedName,
  escapes,
  hasNoindex,
  idOfDir,
  importsOf,
  stageOf,
} from "./prototypes-lib.mjs";

const html = '<meta name="robots" content="noindex, nofollow" />';
const base = {
  dir: "B-0002-morning-digest",
  pkg: { name: "@prototype/b-0002-morning-digest", dependencies: { "@app/ui": "workspace:*" } },
  html,
  files: { "src/App.tsx": 'import { Button } from "@app/ui";' },
  betFile: "B-0002-morning-digest.md",
  betStage: "psf",
};

test("フォルダの名前から賭けの ID", () => {
  assert.equal(idOfDir("B-0002-morning-digest"), "B-0002");
  assert.equal(idOfDir("B-02-x"), undefined);
  assert.equal(idOfDir("B-0002"), undefined);
  assert.equal(idOfDir("sample"), undefined);
});

test("import の名前を集める", () => {
  const text = `import a from "a";\nimport "b";\nexport { c } from 'c';\nconst d = await import("d");`;
  assert.deepEqual(importsOf(text).sort(), ["a", "b", "c", "d"]);
});

test("使ってはいけない名前", () => {
  assert.equal(deniedName("@app/ui"), undefined);
  assert.equal(deniedName("@app/ui/styles.css"), undefined);
  assert.equal(deniedName("@app/api"), "@app/");
  assert.equal(deniedName("@app/uikit"), "@app/");
  assert.equal(deniedName("@aws-sdk/client-s3"), "@aws-sdk/");
  assert.equal(deniedName("pg"), "pg");
  assert.equal(deniedName("pg-format"), undefined);
  assert.equal(deniedName("drizzle-orm/pg-core"), "drizzle-orm");
  assert.equal(deniedName("node:path"), undefined);
  assert.equal(deniedName("node:fs", { src: true }), "node:");
});

test("相対パスがフォルダの外に出るか", () => {
  assert.equal(escapes("src/App.tsx", "./screens/A.tsx"), false);
  assert.equal(escapes("src/screens/A.tsx", "../data.ts"), false);
  assert.equal(escapes("src/App.tsx", "../../apps/api/src/db/client.ts"), true);
  assert.equal(escapes("vite.config.ts", "../x"), true);
  assert.equal(escapes("src/App.tsx", "react"), false);
});

test("コードの検査: API・DB・AWS・.env・VITE_ の値を止める", () => {
  assert.deepEqual(checkSource("src/App.tsx", 'import { Button } from "@app/ui";'), []);
  assert.equal(checkSource("src/a.ts", 'import { db } from "@app/api";').length, 1);
  assert.equal(checkSource("src/a.ts", 'import x from "../../../apps/api/src/x.ts";').length, 1);
  assert.equal(checkSource("src/a.ts", 'import { S3 } from "@aws-sdk/client-s3";').length, 1);
  assert.equal(checkSource("src/a.ts", 'import "./.env.local";').length, 1);
  assert.equal(checkSource("src/a.ts", "const k = import.meta.env.VITE_KEY;").length, 1);
  assert.equal(checkSource("src/a.ts", 'import fs from "node:fs";').length, 1);
  assert.deepEqual(checkSource("vite.config.ts", 'import { basename } from "node:path";'), []);
});

test("依存の検査: ワークスペースは @app/ui だけ", () => {
  assert.deepEqual(checkDeps(base.pkg), []);
  assert.equal(checkDeps({ dependencies: { "@app/shared": "workspace:*" } }).length, 1);
  assert.equal(checkDeps({ devDependencies: { "@aws-sdk/client-s3": "3.0.0" } }).length, 1);
  assert.equal(checkDeps({ dependencies: { "my-lib": "workspace:*" } }).length, 1);
});

test("noindex の meta", () => {
  assert.equal(hasNoindex(html), true);
  assert.equal(hasNoindex('<meta name="robots" content="index" />'), false);
  assert.equal(hasNoindex("<title>x</title>"), false);
});

test("賭けの段階を読む(コメントの中は読まない)", () => {
  const text = "## いまの状態\n\n- 段階: psf\n<!--\n- 段階: idea\n-->";
  assert.equal(stageOf(text), "psf");
  assert.equal(stageOf("<!-- - 段階: idea -->\n- 段階: dropped"), "dropped");
  assert.equal(stageOf("# 無い"), undefined);
});

test("試作の全体: 決まりどおりなら問題なし", () => {
  assert.deepEqual(checkPrototype(base), { problems: [], warnings: [] });
});

test("試作の全体: noindex・賭けのファイル・名前・テストが無いと落とす", () => {
  const r = checkPrototype({
    ...base,
    html: "<title>x</title>",
    betFile: undefined,
    pkg: { ...base.pkg, name: "x", scripts: { test: "vitest" } },
    files: { ...base.files, ".env": "SECRET=1" },
  });
  assert.equal(r.problems.length, 5);
});

test("試作の全体: 終わった賭けは知らせるだけ", () => {
  for (const betStage of ["dropped", "adopted", "retired"]) {
    const r = checkPrototype({ ...base, betStage });
    assert.equal(r.problems.length, 0);
    assert.equal(r.warnings.length, 1);
  }
});

test("試作の全体: フォルダの名前が違う", () => {
  assert.equal(checkPrototype({ ...base, dir: "sample" }).problems.length, 1);
});

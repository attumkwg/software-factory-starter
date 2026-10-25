// pnpm contrast の中身(contrast-lib.mjs)のテスト。node --test scripts/contrast.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  checkTheme,
  contrastRatio,
  failures,
  PAIRS,
  parseHex,
  parseTokens,
  renderTable,
} from "./contrast-lib.mjs";

test("色コードを読む(3桁・6桁・不透明の8桁)。rgb() と半透明は読まない", () => {
  assert.deepEqual(parseHex("#fff"), [255, 255, 255]);
  assert.deepEqual(parseHex(" #0B5CAD "), [11, 92, 173]);
  assert.deepEqual(parseHex("#000000ff"), [0, 0, 0]);
  assert.equal(parseHex("#00000080"), null);
  assert.equal(parseHex("rgb(31 35 40 / 50%)"), null);
  assert.equal(parseHex("#ggg"), null);
});

test("比は WCAG の式どおり。白と黒は 21、同じ色は 1。切り捨てで出す", () => {
  assert.equal(contrastRatio([255, 255, 255], [0, 0, 0]), 21);
  assert.equal(contrastRatio([0, 0, 0], [255, 255, 255]), 21);
  assert.equal(contrastRatio([11, 92, 173], [11, 92, 173]), 1);
  // #777777 と白は 4.4776…。4.47 と出し(切り上げて 4.48 や 4.5 と見せない)、4.5 に届かない
  assert.equal(contrastRatio(parseHex("#777777"), [255, 255, 255]), 4.47);
});

const css = `
/* 見出しのコメント: --color-text: #000000; は読まない */
:root {
  --color-bg: #ffffff;
  --color-text: #1f2328; /* 行のコメント */
  --space-1: 4px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #0d1117;
  }
}
`;

test("明るいテーマは最初の :root、暗いテーマは明るい方に重ねる。コメントは読まない", () => {
  const { light, dark } = parseTokens(css);
  assert.equal(light["--color-bg"], "#ffffff");
  assert.equal(light["--color-text"], "#1f2328");
  assert.equal(dark["--color-bg"], "#0d1117");
  assert.equal(dark["--color-text"], "#1f2328");
});

test("暗いテーマが無ければ dark は null", () => {
  assert.equal(parseTokens(":root { --color-bg: #fff; }").dark, null);
});

test("届かない組と、色が無い組を落とす。参考の組は落とさない", () => {
  const theme = { "--color-text": "#777777", "--color-bg": "#ffffff", "--color-border": "#eeeeee" };
  const pairs = [
    { fg: "--color-text", bg: "--color-bg", level: "text", where: "本文" },
    { fg: "--color-focus", bg: "--color-bg", level: "ui", where: "枠" },
    { fg: "--color-border", bg: "--color-bg", level: "info", where: "線" },
  ];
  const rows = checkTheme(theme, pairs);
  assert.deepEqual(
    failures(rows).map((r) => r.where),
    ["本文", "枠"],
  );
  const table = renderTable("明るいテーマ", rows);
  assert.match(table, /4\.47:1 \| 4\.5:1 \| ❌/);
  assert.match(table, /色が読めない/);
  assert.match(table, /⚠️ 参考/);
});

test("いまの tokens.css は、明るいテーマも暗いテーマも全部の組が届く(色を変えた PR はここで落ちる)", () => {
  const { light, dark } = parseTokens(readFileSync("packages/ui/src/tokens.css", "utf8"));
  assert.ok(dark, "暗いテーマがある");
  for (const theme of [light, dark]) {
    const rows = checkTheme(theme);
    assert.equal(rows.length, PAIRS.length);
    assert.deepEqual(failures(rows), []);
  }
});

// 色のトークンのコントラストの比(WCAG 2.2 AA)。中身は contrast-lib.mjs、テストは contrast.test.mjs。
//   pnpm contrast                 packages/ui/src/tokens.css の明るいテーマ・暗いテーマを、組ごとに表(Markdown)で出す
//   pnpm contrast <a.css> <b.css> 色の案を並べて比べる(/brand が案ごとの tokens.css を手元に書いて渡す)
// 文字 4.5:1・文字でない物 3:1 に届かない組があれば 1 で終わる(参考の組は落とさない)。
// 画面の上の実際の重なりは E2E の axe が確かめる。ここは案の段階で比を出すため。
import { readFileSync } from "node:fs";
import { checkTheme, failures, parseTokens, renderTable } from "./contrast-lib.mjs";

const files = process.argv.slice(2);
if (files.length === 0) files.push("packages/ui/src/tokens.css");

let failed = 0;
for (const file of files) {
  const { light, dark } = parseTokens(readFileSync(file, "utf8"));
  const themes = [["明るいテーマ", light]];
  if (dark) themes.push(["暗いテーマ", dark]);
  console.log(`### ${file}\n`);
  for (const [name, theme] of themes) {
    const rows = checkTheme(theme);
    console.log(`${renderTable(name, rows)}\n`);
    failed += failures(rows).length;
  }
}

if (failed > 0) {
  console.log(`❌ 届かない組が ${failed}件(文字 4.5:1・文字でない物 3:1。WCAG 2.2 AA)`);
  process.exit(1);
}
console.log("✅ どの組も WCAG 2.2 AA に届いています(画面の上の重なりは E2E の axe が確かめる)");

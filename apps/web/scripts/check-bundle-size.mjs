// 画面の JS・CSS の大きさの上限(CI の「Biome・型・単体」で `pnpm --filter @app/web size` が見張る)。
// ビルドのあと(dist/client)の、gzip にしたときの大きさで比べる(ブラウザに届く量に近い。brotli ならもう少し小さい)。
//
// 上限は「2026-10-20 の大きさ+約10%」。根拠と、超えたときの考え方は docs/guides/ci-limits.md。
// 重いライブラリ(日付・グラフ・UI の部品集など。gzip で 20KB〜)を足すと超える幅にしてある。
// 超えたら、まず小さくできないか(要る所だけ読み込む・別のライブラリ)を考え、それでも要るなら
// ここの数字を上げる理由を PR に書く(人が判断する)。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const KB = 1024;
const LIMITS = {
  // 全部の JS(最初に読むもの+画面ごとに後から読むもの)。2026-10-20: 263.6KB・2026-10-26: 290.9KB。
  // 画面が増えれば自然に増える量なので、2026-10-26 に @attumkwg の判断で 290KB → 640KB(2倍強)。
  // 利用者が1つの画面で待つ量は、下の largestJs(最初に必ず読むまとまり)で見る
  totalJs: 640 * KB,
  // 一番大きい JS の1ファイル(React・ルーターなど、最初に必ず読むまとまり)。2026-10-20: 132.6KB
  largestJs: 146 * KB,
  // 全部の CSS。2026-10-20: 1.8KB。小さいので10%では部品1つで超える。幅を KB で取る
  totalCss: 4 * KB,
};

const root = fileURLToPath(new URL("../dist/client", import.meta.url));

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

const gz = (path) => gzipSync(readFileSync(path), { level: 9 }).length;
const js = [];
const css = [];
for (const path of files(root)) {
  if (/\.m?js$/.test(path)) js.push({ path, size: gz(path) });
  else if (path.endsWith(".css")) css.push({ path, size: gz(path) });
}
if (js.length === 0) {
  console.error("dist/client に JS がありません。先に `pnpm --filter @app/web build` を");
  process.exit(1);
}

const sum = (list) => list.reduce((n, f) => n + f.size, 0);
const largest = js.reduce((a, b) => (a.size >= b.size ? a : b));
const checks = [
  { name: "JS の合計", size: sum(js), limit: LIMITS.totalJs },
  {
    name: `一番大きい JS(${relative(root, largest.path)})`,
    size: largest.size,
    limit: LIMITS.largestJs,
  },
  { name: "CSS の合計", size: sum(css), limit: LIMITS.totalCss },
];

const kb = (n) => `${(n / KB).toFixed(1)} KB`;
let failed = false;
for (const c of checks) {
  const ok = c.size <= c.limit;
  failed ||= !ok;
  console.log(`${ok ? "OK  " : "超えた"} ${c.name}: ${kb(c.size)} / 上限 ${kb(c.limit)}(gzip)`);
}
if (failed) {
  console.error(
    "画面の JS・CSS が上限を超えました。docs/guides/ci-limits.md の「超えたら」を見てください",
  );
  process.exit(1);
}

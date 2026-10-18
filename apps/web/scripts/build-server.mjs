// 画面のサーバー(server/index.ts)と TanStack Start の SSR を1つの JS にまとめる。
// 本番のイメージに node_modules を入れずに済み、検査の対象も減る(API の scripts/build.mjs と同じ考え)。
//   vite build が作る dist/server(SSR)を取り込んで dist/index.js を作る。dist/client(配る JS・CSS)はそのまま使う。
import { build } from "esbuild";

await build({
  entryPoints: { index: "server/index.ts" },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  // React などの開発用のコードを外す
  define: { "process.env.NODE_ENV": '"production"' },
  // CommonJS の依存が require を使うので、ESM の中で require を用意する
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: "info",
});

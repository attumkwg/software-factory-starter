// API を1つの JS にまとめる(本番のイメージに node_modules を入れずに済み、検査の対象も減る)。
import { build } from "esbuild";

await build({
  entryPoints: { index: "src/index.ts", cli: "src/cli.ts" },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  // pg の任意のネイティブ版は使わない
  external: ["pg-native"],
  // CommonJS の依存が require を使うので、ESM の中で require を用意する
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: "info",
});

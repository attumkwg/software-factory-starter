import { basename } from "node:path";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 確かめるための試作(docs/guides/prototypes.md)。置き場所は https://<CloudFront>/<賭けの ID>/ なので、
// base はフォルダ名の頭(B-NNNN)から作る。フォルダを写して名前を変えれば、ここは直さなくてよい。
const betId = basename(import.meta.dirname).slice(0, 6);
// 検索に載せない(本番の置き場所は CloudFront の応答ヘッダーでも付ける)
const headers = { "X-Robots-Tag": "noindex, nofollow" };

export default defineConfig({
  base: `/${betId}/`,
  plugins: [viteReact()],
  // .env を読まない(試作に秘密や本番の値を入れない)
  envDir: false,
  server: { port: 5180, headers },
  preview: { port: 5180, headers },
  // 捨てる物なので、大きさの上限(apps/web の size)は見ない。警告だけ黙らせる
  build: { chunkSizeWarningLimit: 1024 },
});

// 配る JS・CSS を、ビルドのときに brotli と gzip で圧縮しておく(dist/client の中に .br / .gz を並べる)。
// ALB は圧縮しないので、ここでやらないと JS が生のまま(数倍の大きさで)届く。
// ビルドのときなら一番強い圧縮にしても、リクエストごとの重さは無い(server/app.ts が .br / .gz を選んで返す)。
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const root = fileURLToPath(new URL("../dist/client", import.meta.url));
const COMPRESSIBLE = /\.(js|mjs|css|html|svg|json|txt)$/;
// これより小さいものは縮めても得が少ない
const MIN_BYTES = 1024;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

let count = 0;
let before = 0;
let after = 0;
for (const path of files(root)) {
  if (!COMPRESSIBLE.test(path)) continue;
  const data = readFileSync(path);
  if (data.length < MIN_BYTES) continue;
  const br = brotliCompressSync(data, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
      [constants.BROTLI_PARAM_SIZE_HINT]: data.length,
    },
  });
  writeFileSync(`${path}.br`, br);
  writeFileSync(`${path}.gz`, gzipSync(data, { level: constants.Z_BEST_COMPRESSION }));
  count += 1;
  before += data.length;
  after += br.length;
}
console.log(
  `圧縮しておいた: ${count} 個(${(before / 1024).toFixed(0)} KB → brotli ${(after / 1024).toFixed(0)} KB)`,
);

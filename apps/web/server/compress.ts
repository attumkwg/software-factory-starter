import { Duplex } from "node:stream";
import { constants, createBrotliCompress, createGzip } from "node:zlib";

// SSR の HTML を、その場で圧縮して返す。ALB は圧縮しないので、ここでやらないと HTML が生のまま届く。
//
// ストリーミング SSR を壊さないように、受け取った塊ごとに圧縮を「流し出す」(flush)。
// ふつうの圧縮は、ある程度たまるまで出さないので、先に描けた部分(画面の枠)が届くのが遅れる。
// 塊ごとに流し出すと少しだけ縮みが悪くなるが、最初の表示が遅れない方を取る。
//
// 強さ: brotli は 4(11 は縮むが1回ごとに重い。その場で圧縮するので速さを取る)・gzip は既定の 6。
// 配る JS・CSS は、ビルドのときに一番強く圧縮しておく(scripts/precompress.mjs。こちらは関係ない)。

const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml)|image\/svg\+xml)/i;
// これより小さいもの(大きさが分かっているときだけ)は縮めても得が少ない
const MIN_BYTES = 1024;

type Encoding = "br" | "gzip";

// Accept-Encoding から使う方を選ぶ(br を先に)。「q=0」は「使わないで」の意味
export function pickEncoding(acceptEncoding: string | null): Encoding | undefined {
  if (!acceptEncoding) return undefined;
  const accepted = new Set<string>();
  for (const part of acceptEncoding.split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    const refused = params.some((p) => /^\s*q=0(\.0*)?\s*$/.test(p));
    if (name && !refused) accepted.add(name.trim());
  }
  if (accepted.has("br")) return "br";
  if (accepted.has("gzip")) return "gzip";
  return undefined;
}

function shouldCompress(request: Request, response: Response): boolean {
  if (request.method !== "GET" || !response.body) return false;
  if (response.status === 204 || response.status === 304) return false;
  const headers = response.headers;
  if (headers.has("content-encoding")) return false;
  if (/no-transform/i.test(headers.get("cache-control") ?? "")) return false;
  if (!COMPRESSIBLE.test(headers.get("content-type") ?? "")) return false;
  const length = headers.get("content-length");
  return length === null || Number(length) >= MIN_BYTES;
}

function compressor(encoding: Encoding) {
  return encoding === "br"
    ? createBrotliCompress({
        flush: constants.BROTLI_OPERATION_FLUSH,
        params: { [constants.BROTLI_PARAM_QUALITY]: 4 },
      })
    : createGzip({ flush: constants.Z_SYNC_FLUSH });
}

export function compressResponse(request: Request, response: Response): Response {
  if (!shouldCompress(request, response)) return response;
  const encoding = pickEncoding(request.headers.get("accept-encoding"));
  if (!encoding || !response.body) return response;

  const headers = new Headers(response.headers);
  headers.set("content-encoding", encoding);
  headers.append("vary", "Accept-Encoding");
  headers.delete("content-length");
  const body = response.body.pipeThrough(
    Duplex.toWeb(compressor(encoding)) as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
  );
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

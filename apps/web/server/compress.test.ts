import { brotliDecompressSync, constants, gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { compressResponse, pickEncoding } from "./compress.ts";

const html = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Response(body, { headers: { "content-type": "text/html; charset=utf-8", ...headers } });
const get = (acceptEncoding?: string) =>
  new Request("http://web/", {
    headers: acceptEncoding ? { "accept-encoding": acceptEncoding } : {},
  });
const big = "<p>こんにちは</p>".repeat(200);

describe("SSR の HTML の圧縮", () => {
  it("br を受け取れるなら br、gzip だけなら gzip。q=0 は使わない", () => {
    expect(pickEncoding("gzip, deflate, br, zstd")).toBe("br");
    expect(pickEncoding("gzip")).toBe("gzip");
    expect(pickEncoding("br;q=0, gzip;q=0.8")).toBe("gzip");
    expect(pickEncoding("identity")).toBeUndefined();
    expect(pickEncoding(null)).toBeUndefined();
  });

  it("br で縮めて返し、Vary を付けて長さを外す", async () => {
    const res = compressResponse(get("gzip, br"), html(big, { "content-length": "99999" }));
    expect(res.headers.get("content-encoding")).toBe("br");
    expect(res.headers.get("vary")).toContain("Accept-Encoding");
    expect(res.headers.get("content-length")).toBeNull();
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.length).toBeLessThan(Buffer.byteLength(big) / 5);
    expect(brotliDecompressSync(bytes).toString()).toBe(big);
  });

  it("gzip しか受け取れないなら gzip", async () => {
    const res = compressResponse(get("gzip"), html(big));
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(gunzipSync(Buffer.from(await res.arrayBuffer())).toString()).toBe(big);
  });

  it("描けた所から順に届く(後ろを待たずに、先の塊が圧縮されて出てくる)", async () => {
    let finish: () => void = () => {};
    const rest = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode("<html><body>枠"));
        await rest; // 後ろ(データを待つ部分)はまだ描けていない
        controller.enqueue(encoder.encode("中身</body></html>"));
        controller.close();
      },
    });
    const res = compressResponse(get("gzip"), html(stream));
    const reader = res.body?.getReader();
    if (!reader) throw new Error("本文が無い");
    const first = await reader.read();
    // 途中までのデータでも読める(塊ごとに流し出している)
    const head = gunzipSync(Buffer.from(first.value ?? []), {
      finishFlush: constants.Z_SYNC_FLUSH,
    }).toString();
    expect(head).toBe("<html><body>枠");
    finish();
    const chunks = [Buffer.from(first.value ?? [])];
    for (let r = await reader.read(); !r.done; r = await reader.read())
      chunks.push(Buffer.from(r.value));
    expect(gunzipSync(Buffer.concat(chunks)).toString()).toBe("<html><body>枠中身</body></html>");
  });

  it("縮めないもの: 受け取れない・小さい・もう縮んでいる・転送(本文なし)・HEAD・画像", () => {
    const small = html("<p>hi</p>", { "content-length": "9" });
    expect(compressResponse(get(), html(big)).headers.get("content-encoding")).toBeNull();
    expect(compressResponse(get("br"), small).headers.get("content-encoding")).toBeNull();
    const already = html(big, { "content-encoding": "gzip" });
    expect(compressResponse(get("br"), already).headers.get("content-encoding")).toBe("gzip");
    const redirect = new Response(null, { status: 302, headers: { location: "/login" } });
    expect(compressResponse(get("br"), redirect)).toBe(redirect);
    const head = new Request("http://web/", {
      method: "HEAD",
      headers: { "accept-encoding": "br" },
    });
    expect(compressResponse(head, html(big)).headers.get("content-encoding")).toBeNull();
    const png = new Response(big, { headers: { "content-type": "image/png" } });
    expect(compressResponse(get("br"), png).headers.get("content-encoding")).toBeNull();
  });
});

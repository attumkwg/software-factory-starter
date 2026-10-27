import { describe, expect, it } from "vitest";
import {
  BrokenFileError,
  detectContentType,
  exifOrientation,
  orientationOnlyExif,
  stripMetadata,
} from "../../src/storage/strip-metadata.ts";

// 写真の付いた情報を外す(ADR 0080)。撮った場所(GPS)・XMP・文字の欄が残らず、画素と色と向きは残る。

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const bytes = (...parts: (number[] | Uint8Array)[]) =>
  Uint8Array.from(parts.flatMap((p) => [...p]));
const has = (b: Uint8Array, text: string) => Buffer.from(b).includes(Buffer.from(text, "latin1"));
const u16be = (n: number) => [n >> 8, n & 0xff];
const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];

const jpegSegment = (marker: number, payload: number[]) => [
  0xff,
  marker,
  ...u16be(payload.length + 2),
  ...payload,
];

/** リトルエンディアンの EXIF: 向き+GPS の IFD への印+GPS の中身(印の文字列) */
function exifPayload(orientation: number): number[] {
  const tiff = [
    ...ascii("II"),
    0x2a,
    0x00,
    ...u32le(8),
    // IFD0: 項目2つ
    0x02,
    0x00,
    // 向き(0x0112)・SHORT・1・値
    0x12,
    0x01,
    0x03,
    0x00,
    ...u32le(1),
    orientation,
    0x00,
    0x00,
    0x00,
    // GPS の IFD への印(0x8825)・LONG・1・場所
    0x25,
    0x88,
    0x04,
    0x00,
    ...u32le(1),
    ...u32le(38),
    ...u32le(0),
    ...ascii("GPS-35.6895N-139.6917E"),
  ];
  return [...ascii("Exif"), 0, 0, ...tiff];
}

const SCAN = [0x12, 0x34, 0xff, 0x00, 0x56];

function jpeg(orientation: number) {
  return bytes(
    [0xff, 0xd8],
    jpegSegment(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    jpegSegment(0xe1, exifPayload(orientation)),
    jpegSegment(0xe1, [...ascii("http://ns.adobe.com/xap/1.0/"), 0, ...ascii("<x:xmpmeta/>")]),
    jpegSegment(0xed, [...ascii("Photoshop 3.0"), 0, ...ascii("IPTC-CITY")]),
    jpegSegment(0xfe, ascii("comment-secret")),
    jpegSegment(0xe2, [...ascii("ICC_PROFILE"), 0, 1, 1, 9, 9]),
    jpegSegment(0xdb, [0, 1, 2, 3]),
    jpegSegment(0xda, [1, 2, 3]),
    SCAN,
    [0xff, 0xd9],
  );
}

describe("JPEG", () => {
  it("EXIF(GPS)・XMP・IPTC・コメントを外し、JFIF・色・量子化表・画素は残す", () => {
    const out = stripMetadata(jpeg(1), "image/jpeg");
    for (const secret of ["GPS-35.6895N", "xmpmeta", "IPTC-CITY", "comment-secret", "Exif"]) {
      expect(has(out, secret)).toBe(false);
    }
    expect(has(out, "JFIF")).toBe(true);
    expect(has(out, "ICC_PROFILE")).toBe(true);
    expect([...out.subarray(0, 2)]).toEqual([0xff, 0xd8]);
    expect([...out.subarray(-7)]).toEqual([...SCAN, 0xff, 0xd9]);
    expect(detectContentType(out)).toBe("image/jpeg");
  });

  it("向きが 1 以外なら、向きだけの EXIF を JFIF の後ろに入れ直す", () => {
    const out = stripMetadata(jpeg(6), "image/jpeg");
    expect(has(out, "GPS-35.6895N")).toBe(false);
    const app0Length = (out[4] as number) * 256 + (out[5] as number);
    const app1At = 4 + app0Length;
    expect([out[app1At], out[app1At + 1]]).toEqual([0xff, 0xe1]);
    const app1 = orientationOnlyExif(6);
    expect([...out.subarray(app1At, app1At + app1.length)]).toEqual([...app1]);
    expect(exifOrientation(app1.subarray(4))).toBe(6);
  });

  it("向きを読む: ビッグエンディアン・無い・おかしな値", () => {
    expect(exifOrientation(orientationOnlyExif(8).subarray(4))).toBe(8);
    expect(exifOrientation(Uint8Array.from(exifPayload(3)))).toBe(3);
    expect(exifOrientation(Uint8Array.from(exifPayload(42)))).toBeNull();
    expect(exifOrientation(Uint8Array.from(ascii("http://ns.adobe.com/xap/1.0/")))).toBeNull();
  });

  it("途中で切れた・区切りの無い JPEG は断る", () => {
    const whole = jpeg(1);
    expect(() => stripMetadata(whole.subarray(0, 30), "image/jpeg")).toThrow(BrokenFileError);
    expect(() => stripMetadata(bytes([0xff, 0xd8, 0x00, 0x00, 0, 0]), "image/jpeg")).toThrow(
      BrokenFileError,
    );
    expect(() => stripMetadata(bytes([0xff, 0xd8], [0xff, 0xd9, 0, 0]), "image/jpeg")).toThrow(
      BrokenFileError,
    );
  });
});

const pngChunk = (type: string, data: number[]) => [
  ...u16be(0),
  ...u16be(data.length),
  ...ascii(type),
  ...data,
  0,
  0,
  0,
  0,
];
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("PNG", () => {
  it("eXIf・文字の欄・時刻の塊を外し、ほかは残す", () => {
    const png = bytes(
      PNG_SIG,
      pngChunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
      pngChunk("tEXt", [...ascii("Comment"), 0, ...ascii("text-secret")]),
      pngChunk("iTXt", ascii("itxt-secret")),
      pngChunk("zTXt", ascii("ztxt-secret")),
      pngChunk("eXIf", ascii("MM-exif-secret")),
      pngChunk("tIME", [7, 234, 10, 27, 0, 0, 0]),
      pngChunk("IDAT", [1, 2, 3]),
      pngChunk("IEND", []),
    );
    const out = stripMetadata(png, "image/png");
    for (const secret of ["text-secret", "itxt-secret", "ztxt-secret", "exif-secret", "tIME"]) {
      expect(has(out, secret)).toBe(false);
    }
    expect(has(out, "IHDR") && has(out, "IDAT") && has(out, "IEND")).toBe(true);
    expect(detectContentType(out)).toBe("image/png");
  });

  it("終わり(IEND)の無い PNG は断る", () => {
    expect(() =>
      stripMetadata(bytes(PNG_SIG, pngChunk("IHDR", [0, 0, 0, 1])), "image/png"),
    ).toThrow(BrokenFileError);
  });
});

const webpChunk = (type: string, data: number[]) => [
  ...ascii(type),
  ...u32le(data.length),
  ...data,
  ...(data.length % 2 ? [0] : []),
];

function webp(...chunks: number[][]) {
  const body = chunks.flat();
  return bytes(ascii("RIFF"), u32le(4 + body.length), ascii("WEBP"), body);
}

describe("WebP", () => {
  it("EXIF・XMP の塊を外し、VP8X の印と RIFF の大きさを直す", () => {
    const VP8X_FLAGS = 0x10 | 0x08 | 0x04; // 透明・EXIF・XMP
    const input = webp(
      webpChunk("VP8X", [VP8X_FLAGS, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      webpChunk("VP8L", [1, 2, 3, 4, 5]),
      webpChunk("EXIF", ascii("exif-secret")),
      webpChunk("XMP ", ascii("<xmp-secret/>")),
    );
    const out = stripMetadata(input, "image/webp");
    expect(has(out, "exif-secret") || has(out, "xmp-secret")).toBe(false);
    expect(out[20]).toBe(0x10); // VP8X の印は透明だけ
    const riffSize = new DataView(out.buffer, out.byteOffset).getUint32(4, true);
    expect(riffSize).toBe(out.length - 8);
    expect(detectContentType(out)).toBe("image/webp");
  });

  it("大きさが合わない WebP は断る", () => {
    const input = webp(webpChunk("VP8L", [1, 2, 3, 4]));
    expect(() => stripMetadata(input.subarray(0, input.length - 2), "image/webp")).toThrow(
      BrokenFileError,
    );
  });
});

describe("種類を中身で決める", () => {
  it.each([
    ["<html><script>", null],
    ['<svg xmlns="http://www.w3.org/2000/svg">', null],
    ["GIF89a", null],
    ["%PDF-1.7", "application/pdf"],
  ])("%s → %s", (head, type) => {
    expect(detectContentType(Uint8Array.from(ascii(head)))).toBe(type);
  });

  it("PDF は書き直さない", () => {
    const pdf = Uint8Array.from(ascii("%PDF-1.7\n/Author (someone)"));
    expect(stripMetadata(pdf, "application/pdf")).toBe(pdf);
  });
});

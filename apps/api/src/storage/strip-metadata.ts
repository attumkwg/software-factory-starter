import type { FileContentType } from "@app/shared";

// 上げた物の種類を中身で確かめ、写真の付いた情報(撮った場所・日時・機種・文字の欄)を外す(ADR 0080)。
// 画素は作り直さない(塊を外すだけ)ので、画質は落ちない。依存は足さない。
//
//   JPEG … APP1(EXIF・XMP)・APP13(IPTC)・COM を外す。JFIF(APP0)・色(APP2 の ICC)・APP14 は残す。
//          向き(Orientation)が 1 以外なら、向きだけの小さな EXIF を入れ直す(外すと写真が横に倒れる)
//   PNG  … eXIf・tEXt・zTXt・iTXt・tIME の塊を外す
//   WebP … EXIF・XMP の塊を外し、VP8X の印と RIFF の大きさを直す
//   PDF  … 種類を確かめるだけ(書き直さない)
// 形が壊れていれば投げる(呼び出し側が rejected にする)。

export class BrokenFileError extends Error {
  constructor(what: string) {
    super(`ファイルの形が壊れています(${what})`);
    this.name = "BrokenFileError";
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const startsWith = (b: Uint8Array, bytes: number[], at = 0) =>
  b.length >= at + bytes.length && bytes.every((x, i) => b[at + i] === x);
const ascii = (s: string) => [...s].map((ch) => ch.charCodeAt(0));

/** 先頭の数バイトから種類を決める。決めた4つのどれでもなければ null */
export function detectContentType(b: Uint8Array): FileContentType | null {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(b, PNG_SIGNATURE)) return "image/png";
  if (startsWith(b, ascii("RIFF")) && startsWith(b, ascii("WEBP"), 8)) return "image/webp";
  if (startsWith(b, ascii("%PDF-"))) return "application/pdf";
  return null;
}

/** 種類ごとに付いた情報を外した中身を返す(PDF はそのまま) */
export function stripMetadata(b: Uint8Array, type: FileContentType): Uint8Array {
  switch (type) {
    case "image/jpeg":
      return stripJpeg(b);
    case "image/png":
      return stripPng(b);
    case "image/webp":
      return stripWebp(b);
    case "application/pdf":
      return b;
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ── JPEG ───────────────────────────────────────────────────────────────

const APP0 = 0xe0;
const APP1 = 0xe1;
const APP13 = 0xed;
const COM = 0xfe;
const SOS = 0xda;
const EOI = 0xd9;
const DROP_JPEG = new Set([APP1, APP13, COM]);

type JpegSegment = { marker: number; start: number; end: number };

/** at から1つの塊を読む(埋め草の 0xFF は飛ばす)。画像の本体(SOS)なら end はファイルの終わり */
function jpegSegment(b: Uint8Array, from: number): JpegSegment {
  let at = from;
  while (b[at] === 0xff && b[at + 1] === 0xff) at += 1; // 埋め草
  if (at + 4 > b.length || b[at] !== 0xff) throw new BrokenFileError("JPEG の区切り");
  const marker = b[at + 1] as number;
  if (marker === SOS) return { marker, start: at, end: b.length };
  if (marker === EOI || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
    throw new BrokenFileError("JPEG の画像の前に終わり");
  }
  const length = ((b[at + 2] as number) << 8) | (b[at + 3] as number);
  const end = at + 2 + length;
  if (length < 2 || end > b.length) throw new BrokenFileError("JPEG の塊の長さ");
  return { marker, start: at, end };
}

function stripJpeg(b: Uint8Array): Uint8Array {
  const kept: Uint8Array[] = [b.subarray(0, 2)];
  let orientation = 1;
  let insertAt = 1; // 向きの EXIF を入れる所(JFIF の後ろ)
  let at = 2;
  for (;;) {
    const seg = jpegSegment(b, at);
    const bytes = b.subarray(seg.start, seg.end);
    if (seg.marker === SOS) {
      kept.push(bytes); // 画素の本体から後ろはそのまま
      break;
    }
    if (seg.marker === APP1) orientation = exifOrientation(bytes.subarray(4)) ?? orientation;
    if (!DROP_JPEG.has(seg.marker)) kept.push(bytes);
    if (seg.marker === APP0) insertAt = kept.length;
    at = seg.end;
  }
  if (orientation !== 1) kept.splice(insertAt, 0, orientationOnlyExif(orientation));
  return concat(kept);
}

/** APP1 の中身が EXIF なら、最初の IFD の向き(0x0112)を読む。無い・読めなければ null */
export function exifOrientation(app1: Uint8Array): number | null {
  if (!startsWith(app1, [...ascii("Exif"), 0, 0])) return null;
  const t = app1.subarray(6);
  const little = startsWith(t, [0x49, 0x49]);
  if (t.length < 8 || (!little && !startsWith(t, [0x4d, 0x4d]))) return null;
  const view = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const u16 = (o: number) => view.getUint16(o, little);
  const ifd = view.getUint32(4, little);
  if (ifd + 2 > t.length) return null;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > t.length) return null;
    // 型 3(SHORT)・数 1 の値は、値の欄の先頭2バイト
    if (u16(entry) === 0x0112 && u16(entry + 2) === 3) return validOrientation(u16(entry + 8));
  }
  return null;
}

const validOrientation = (v: number) => (v >= 1 && v <= 8 ? v : null);

/** 向きだけを入れた APP1(EXIF・ビッグエンディアン・IFD が1つで項目が1つ) */
export function orientationOnlyExif(orientation: number): Uint8Array {
  const payload = [
    ...ascii("Exif"),
    0,
    0,
    // TIFF の頭: MM・42・最初の IFD は 8 バイト目
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08,
    // IFD: 項目 1つ
    0x00,
    0x01,
    // 0x0112(向き)・型 3(SHORT)・数 1・値(2バイト+埋め2バイト)
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    orientation,
    0x00,
    0x00,
    // 次の IFD は無い
    0x00,
    0x00,
    0x00,
    0x00,
  ];
  const length = payload.length + 2;
  return Uint8Array.from([0xff, APP1, length >> 8, length & 0xff, ...payload]);
}

// ── PNG ────────────────────────────────────────────────────────────────

const DROP_PNG = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

function stripPng(b: Uint8Array): Uint8Array {
  const kept: Uint8Array[] = [b.subarray(0, 8)];
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let at = 8;
  for (;;) {
    if (at + 12 > b.length) throw new BrokenFileError("PNG の塊");
    const length = view.getUint32(at);
    const type = String.fromCharCode(...b.subarray(at + 4, at + 8));
    const end = at + 12 + length;
    if (end > b.length) throw new BrokenFileError("PNG の塊の長さ");
    if (!DROP_PNG.has(type)) kept.push(b.subarray(at, end));
    at = end;
    if (type === "IEND") break;
  }
  return concat(kept);
}

// ── WebP ───────────────────────────────────────────────────────────────

const DROP_WEBP = new Set(["EXIF", "XMP "]);
/** VP8X の印: EXIF(0x08)・XMP(0x04) */
const VP8X_METADATA_FLAGS = 0x08 | 0x04;

function stripWebp(b: Uint8Array): Uint8Array {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const riffEnd = 8 + view.getUint32(4, true);
  if (riffEnd > b.length || riffEnd < 12) throw new BrokenFileError("WebP の大きさ");
  const kept: Uint8Array[] = [];
  let at = 12;
  while (at < riffEnd) {
    if (at + 8 > riffEnd) throw new BrokenFileError("WebP の塊");
    const type = String.fromCharCode(...b.subarray(at, at + 4));
    const size = view.getUint32(at + 4, true);
    const end = at + 8 + size + (size % 2); // 奇数の長さは1バイト埋める
    if (end > riffEnd) throw new BrokenFileError("WebP の塊の長さ");
    if (!DROP_WEBP.has(type)) {
      const chunk = b.slice(at, end);
      if (type === "VP8X" && size >= 1) {
        chunk[8] = (chunk[8] as number) & ~VP8X_METADATA_FLAGS;
      }
      kept.push(chunk);
    }
    at = end;
  }
  const body = concat(kept);
  const head = new Uint8Array(12);
  head.set(b.subarray(0, 12));
  new DataView(head.buffer).setUint32(4, 4 + body.length, true);
  return concat([head, body]);
}

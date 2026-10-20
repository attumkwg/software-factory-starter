import { createHmac, randomBytes } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(s: string): Buffer {
  let bits = "";
  for (const ch of s.replace(/=+$/, "").toUpperCase()) {
    const i = BASE32.indexOf(ch);
    if (i >= 0) bits += i.toString(2).padStart(5, "0");
  }
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((b) => Number.parseInt(b, 2)));
}

/** 二段階認証の秘密(base32 の32文字) */
export function newTotpSecret(): string {
  return Array.from(randomBytes(32), (x) => BASE32[x % 32]).join("");
}

/** 二段階認証のコード(TOTP。RFC 6238・SHA-1・30秒・6桁)。テストと契約テストからも使う */
export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = (h[h.length - 1] ?? 0) & 0xf;
  const n = (h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return n.toString().padStart(6, "0");
}

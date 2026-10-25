import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// 要配慮の値を、組織ごとのデータ鍵で暗号化する(AES-256-GCM。ADR 0029)。
// 暗号文に「どの組織の・どの列の・どの行の値か」を結びつける(追加の認証データ = AAD)。
// 別の行・別の列・別の組織へ暗号文を写しても、開けない(書き換えを見抜く)。
//
// 形: s1.<nonce>.<暗号文>.<認証タグ>(どれも base64url)。s1 は形の版(変えるときは s2 を足し、両方を読めるようにする)

const VERSION = "s1";
const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
export const DATA_KEY_BYTES = 32;

/** 暗号文を開けなかった(鍵が違う・書き換えられた・別の行の物・形が違う)。中身の手がかりは持たない */
export class SealedValueError extends Error {
  constructor() {
    super("要配慮の値を開けませんでした");
  }
}

/** 何の値か。AAD になる(暗号文には入らないが、開くときに同じ物が要る) */
export type SealContext = { tenantId: string; field: string; rowId: string };

const aadOf = (c: SealContext) => Buffer.from(`${VERSION}|${c.tenantId}|${c.field}|${c.rowId}`);

export function seal(key: Buffer, context: SealContext, plain: string): string {
  if (key.length !== DATA_KEY_BYTES) throw new Error("データ鍵は32バイトです");
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aadOf(context));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, nonce, body, cipher.getAuthTag()]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

export function open(key: Buffer, context: SealContext, sealed: string): string {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new SealedValueError();
  const [nonce, body, tag] = parts.slice(1).map((p) => Buffer.from(p, "base64url"));
  if (nonce?.length !== NONCE_BYTES || tag?.length !== TAG_BYTES || !body) {
    throw new SealedValueError();
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(aadOf(context));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    throw new SealedValueError();
  }
}

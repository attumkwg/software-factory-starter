import { createHmac, timingSafeEqual } from "node:crypto";

// 確認・取り消しのリンクの token(設計書 0025 の 3)。`<登録の ID>.<署名>` の形。
// 署名は「用途・登録の ID・時刻」を、SESSION_SECRET から作った鍵で HMAC-SHA256 したもの。
// - token を DB に持たない(漏れても使える物が DB に無い)。アウトボックスが同じ出来事を2回届けても、同じリンクになる
// - 確認の時刻は confirm_sent_at(送り直すと前のリンクは使えなくなる)・取り消しの時刻は created_at(行がある間は使える)
// - 公開のページの URL の # の後ろに載せる(# の後ろはサーバーに届かないので、アクセスログに残らない)

export type LinkPurpose = "confirm" | "withdraw";

/** SESSION_SECRET から、リンク専用の鍵を作る(セッションの署名と同じ鍵を使い回さない) */
export function linkKey(sessionSecret: string): Buffer {
  return createHmac("sha256", sessionSecret).update("growth.pre_registration_links").digest();
}

const sign = (key: Buffer, purpose: LinkPurpose, id: string, at: Date) =>
  createHmac("sha256", key).update(`${purpose}:${id}:${at.toISOString()}`).digest("base64url");

export function makeLinkToken(key: Buffer, purpose: LinkPurpose, id: string, at: Date): string {
  return `${id}.${sign(key, purpose, id, at)}`;
}

/** token から登録の ID を取り出す(形が違えば null)。署名はまだ確かめていない */
export function idOfLinkToken(token: string): string | null {
  const [id, signature, ...rest] = token.split(".");
  if (rest.length > 0 || !id || !signature) return null;
  return /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id) ? id : null;
}

/** token が、この行の時刻から作った物と同じか(時間で差が出ない比べ方) */
export function verifyLinkToken(
  key: Buffer,
  purpose: LinkPurpose,
  token: string,
  id: string,
  at: Date,
): boolean {
  const expected = Buffer.from(makeLinkToken(key, purpose, id, at));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

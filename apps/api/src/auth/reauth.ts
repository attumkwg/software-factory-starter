import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { SessionConfig } from "./session.ts";

// 確かめ直しの札(ADR 0016)。パスワード(と二段階認証のコード)を入れ直して得た Cognito のアクセストークンを、
// 二段階認証の設定(鍵 → コード)とメールの変更(申し込み → 確認コード)の間だけ持つ。
//   - AES-256-GCM で暗号化した HttpOnly Cookie(JS から読めない・鍵が無ければ中身も見えない)。10分・SameSite=Strict
//   - 鍵は SESSION_SECRET から HKDF で作る(セッションの署名の鍵とは別)
//   - 本人(userId)に結びつける。セッションの本人と違えば使わない
//   - 変更を1回終えたら消し、Cognito の GlobalSignOut でアクセストークンそのものも無効にする(account-routes.ts)

/** 札の長さ。アクセストークン(15分)より短く、QR を読んでコードを入れるのに足りる長さ */
export const REAUTH_TTL_SECONDS = 10 * 60;

export type Reauth = { userId: string; accessToken: string };

const IV_BYTES = 12;
const TAG_BYTES = 16;

// __Host- は Secure・Path=/・Domain なしでしか置けない(サブドメインからの上書きを防ぐ)
const cookieName = (cfg: SessionConfig) => (cfg.secureCookie ? "__Host-reauth" : "reauth");

function keyOf(cfg: SessionConfig): Buffer {
  return Buffer.from(hkdfSync("sha256", cfg.secret, "", "reauth-v1", 32));
}

export function sealReauth(cfg: SessionConfig, r: Reauth, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + REAUTH_TTL_SECONDS;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyOf(cfg), iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify({ ...r, exp }), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** 開けて確かめる。壊れている・書き換えられている・切れている・本人違いなら null */
export function openReauth(
  cfg: SessionConfig,
  sealed: string,
  userId: string,
  now = Date.now(),
): Reauth | null {
  try {
    const raw = Buffer.from(sealed, "base64url");
    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", keyOf(cfg), iv);
    decipher.setAuthTag(tag);
    const text = Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
    const v = JSON.parse(text) as Record<string, unknown>;
    if (v.userId !== userId || typeof v.accessToken !== "string") return null;
    if (typeof v.exp !== "number" || v.exp <= Math.floor(now / 1000)) return null;
    return { userId, accessToken: v.accessToken };
  } catch {
    return null;
  }
}

export function writeReauth(c: Context, cfg: SessionConfig, r: Reauth) {
  setCookie(c, cookieName(cfg), sealReauth(cfg, r), {
    httpOnly: true,
    secure: cfg.secureCookie,
    sameSite: "Strict",
    path: "/",
    maxAge: REAUTH_TTL_SECONDS,
  });
}

export function readReauth(c: Context, cfg: SessionConfig, userId: string): Reauth | null {
  const sealed = getCookie(c, cookieName(cfg));
  return sealed ? openReauth(cfg, sealed, userId) : null;
}

export function clearReauth(c: Context, cfg: SessionConfig) {
  deleteCookie(c, cookieName(cfg), { path: "/", secure: cfg.secureCookie });
}

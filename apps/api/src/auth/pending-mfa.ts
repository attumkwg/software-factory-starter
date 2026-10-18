import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import type { SessionConfig } from "./session.ts";

// パスワードが通って、二段階認証のコードを待っている間だけ持つ「ログインの途中」。署名つきの HttpOnly Cookie。
//   session … Cognito が返した「このログインの続き」の札(3分で切れる。中身は Cognito しか読めない)
//   email   … コードを返すときに Cognito に添える
// ブラウザの JS からは読めない。コードを返したら、成否にかかわらず消す。

export type PendingMfa = { session: string; email: string };

// Cognito の札が切れるのと同じ3分
const TTL_SECONDS = 3 * 60;

// __Host- は Secure・Path=/・Domain なしでしか置けない(サブドメインからの上書きを防ぐ)
const cookieName = (cfg: SessionConfig) => (cfg.secureCookie ? "__Host-mfa" : "mfa");

export async function writePendingMfa(c: Context, cfg: SessionConfig, p: PendingMfa) {
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const value = Buffer.from(JSON.stringify({ ...p, exp })).toString("base64url");
  await setSignedCookie(c, cookieName(cfg), value, cfg.secret, {
    httpOnly: true,
    secure: cfg.secureCookie,
    sameSite: "Strict",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

/** 読んで、すぐ消す。無い・壊れている・切れている・署名が合わないなら null */
export async function takePendingMfa(c: Context, cfg: SessionConfig): Promise<PendingMfa | null> {
  const raw = await getSignedCookie(c, cfg.secret, cookieName(cfg));
  deleteCookie(c, cookieName(cfg), { path: "/", secure: cfg.secureCookie });
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof v.session !== "string" || typeof v.email !== "string") return null;
    if (typeof v.exp !== "number" || v.exp < Math.floor(Date.now() / 1000)) return null;
    return { session: v.session, email: v.email };
  } catch {
    return null;
  }
}

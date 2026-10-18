import { safeReturnTo } from "@app/shared";
import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import type { SessionConfig } from "./session.ts";

// Cognito へ行って戻ってくるまでの間だけ持つ「ログインの途中」。署名つきの HttpOnly Cookie に入れる。
//   state        … 戻ってきたのが、この画面から始めたログインか(取り違え・CSRF の防止)
//   nonce        … ID トークンが、このログインのために作られた物か(使い回しの防止)
//   codeVerifier … PKCE。code を盗まれても、これが無いとトークンに替えられない
//   returnTo     … ログインの後に戻る画面(アプリの中のパスだけ)
// 10分で切れる。戻ってきたら成否にかかわらず消す(同じ途中の状態を2回使わせない)。

export type PendingLogin = {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
};

const TTL_SECONDS = 10 * 60;

// __Host- は Secure・Path=/・Domain なしでしか置けない(サブドメインからの上書きを防ぐ)
const cookieName = (cfg: SessionConfig) => (cfg.secureCookie ? "__Host-login" : "login");

export async function writePendingLogin(c: Context, cfg: SessionConfig, p: PendingLogin) {
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const value = Buffer.from(JSON.stringify({ ...p, exp })).toString("base64url");
  // Cognito から戻るのは「よそのサイトからのページの移動(GET)」。SameSite=Lax なら付いてくる
  await setSignedCookie(c, cookieName(cfg), value, cfg.secret, {
    httpOnly: true,
    secure: cfg.secureCookie,
    sameSite: "Lax",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

/** 読んで、すぐ消す。無い・壊れている・切れている・署名が合わないなら null */
export async function takePendingLogin(
  c: Context,
  cfg: SessionConfig,
): Promise<PendingLogin | null> {
  const raw = await getSignedCookie(c, cfg.secret, cookieName(cfg));
  deleteCookie(c, cookieName(cfg), { path: "/", secure: cfg.secureCookie });
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Record<string, unknown>;
    const { state, nonce, codeVerifier, exp } = v;
    if (typeof state !== "string" || typeof nonce !== "string" || typeof codeVerifier !== "string")
      return null;
    if (typeof exp !== "number" || exp < Math.floor(Date.now() / 1000)) return null;
    return { state, nonce, codeVerifier, returnTo: safeReturnTo(v.returnTo) };
  } catch {
    return null;
  }
}

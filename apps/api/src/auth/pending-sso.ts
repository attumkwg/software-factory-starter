import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import type { SessionConfig } from "./session.ts";

// SSO で IdP へ回っている間だけ持つ「ログインの途中」(docs/designs/0056-sso-scim-ip-audit-export.md の 0)。
// 署名つきの HttpOnly Cookie(pending-mfa.ts と同じ形)。
//   state    … 戻ってきた要求がこのブラウザから始めた物か(CSRF)
//   verifier … PKCE。コードを盗まれても、これが無ければトークンに換えられない
//   provider … 回した IdP の名前。戻ってきたトークンの IdP と合わなければ断る
// 戻りは Cognito からの移動(別のサイトからの GET)なので SameSite は Lax(Strict だと Cookie が届かない)。

export type PendingSso = { state: string; verifier: string; provider: string };

// IdP で会社のパスワード・二段階認証を入れる時間
const TTL_SECONDS = 10 * 60;

const cookieName = (cfg: SessionConfig) => (cfg.secureCookie ? "__Host-sso" : "sso");
const random = () => randomBytes(32).toString("base64url");

/** 新しい途中の状態を作り、Cookie に置く。IdP へ回す URL に載せる state と code_challenge を返す */
export async function startPendingSso(
  c: Context,
  cfg: SessionConfig,
  provider: string,
): Promise<{ state: string; codeChallenge: string }> {
  const p: PendingSso = { state: random(), verifier: random(), provider };
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const value = Buffer.from(JSON.stringify({ ...p, exp })).toString("base64url");
  await setSignedCookie(c, cookieName(cfg), value, cfg.secret, {
    httpOnly: true,
    secure: cfg.secureCookie,
    sameSite: "Lax",
    path: "/",
    maxAge: TTL_SECONDS,
  });
  const codeChallenge = createHash("sha256").update(p.verifier).digest("base64url");
  return { state: p.state, codeChallenge };
}

/** 読んで、すぐ消す。無い・壊れている・切れている・署名が合わない・state が違うなら null */
export async function takePendingSso(
  c: Context,
  cfg: SessionConfig,
  state: string,
): Promise<PendingSso | null> {
  const raw = await getSignedCookie(c, cfg.secret, cookieName(cfg));
  deleteCookie(c, cookieName(cfg), { path: "/", secure: cfg.secureCookie });
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof v.state !== "string" || typeof v.verifier !== "string") return null;
    if (typeof v.provider !== "string") return null;
    if (typeof v.exp !== "number" || v.exp < Math.floor(Date.now() / 1000)) return null;
    if (!sameText(v.state, state)) return null;
    return { state: v.state, verifier: v.verifier, provider: v.provider };
  } catch {
    return null;
  }
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

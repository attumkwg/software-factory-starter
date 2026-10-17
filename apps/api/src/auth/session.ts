import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import type { Session } from "../env.ts";

// セッションは署名つきの HttpOnly Cookie(トークンを localStorage に置かない)。
// 中身は「誰が・どのテナントか・いつまでか」だけ。ロールは毎回 DB から引く(変更がすぐ効く)。
// 次の一歩: サーバー側のセッション保存(DB か Valkey)にして、強制ログアウトをできるようにする。

export type SessionConfig = { secret: string; ttlSeconds: number; secureCookie: boolean };

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

function cookieName(cfg: SessionConfig) {
  // __Host- は Secure・Path=/・Domain なしでしか置けない(サブドメインからの上書きを防ぐ)
  return cfg.secureCookie ? "__Host-sid" : "sid";
}

export async function readSession(c: Context, cfg: SessionConfig): Promise<Session | null> {
  const raw = await getSignedCookie(c, cfg.secret, cookieName(cfg));
  if (!raw) return null;
  const [userId, tenantId, exp] = raw.split(".");
  if (!userId || !tenantId || !exp || !UUID.test(userId) || !UUID.test(tenantId)) return null;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return null;
  return { userId, tenantId };
}

export async function writeSession(c: Context, cfg: SessionConfig, s: Session): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + cfg.ttlSeconds;
  await setSignedCookie(c, cookieName(cfg), `${s.userId}.${s.tenantId}.${exp}`, cfg.secret, {
    httpOnly: true,
    secure: cfg.secureCookie,
    sameSite: "Lax",
    path: "/",
    maxAge: cfg.ttlSeconds,
  });
}

export function clearSession(c: Context, cfg: SessionConfig): void {
  deleteCookie(c, cookieName(cfg), { path: "/", secure: cfg.secureCookie });
}

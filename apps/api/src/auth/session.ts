import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import type { Session } from "../env.ts";

// セッションは署名つきの HttpOnly Cookie(トークンを localStorage に置かない)。
// 中身は「誰が・どのテナントか・いつまでか」だけ。ロールは毎回 DB から引く(変更がすぐ効く)。
//   ふつう   … 「人.組織.期限」
//   代理の間 … 「社員.社員の本来の組織.期限.入室の ID.見ている組織」(docs/specs/0004-support-access.md)
//              入室が生きているか(期限・取り消し)は、認可の関所が毎回 DB で確かめる。
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
  const [userId, tenantId, exp, supportSessionId, actingTenantId, ...rest] = raw.split(".");
  if (!userId || !tenantId || !exp || !UUID.test(userId) || !UUID.test(tenantId)) return null;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return null;
  if (rest.length > 0) return null;
  if (supportSessionId === undefined && actingTenantId === undefined) return { userId, tenantId };
  if (
    !supportSessionId ||
    !actingTenantId ||
    !UUID.test(supportSessionId) ||
    !UUID.test(actingTenantId)
  )
    return null;
  return {
    userId,
    tenantId: actingTenantId,
    support: { sessionId: supportSessionId, homeTenantId: tenantId },
  };
}

export async function writeSession(c: Context, cfg: SessionConfig, s: Session): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + cfg.ttlSeconds;
  const value = s.support
    ? `${s.userId}.${s.support.homeTenantId}.${exp}.${s.support.sessionId}.${s.tenantId}`
    : `${s.userId}.${s.tenantId}.${exp}`;
  await setSignedCookie(c, cookieName(cfg), value, cfg.secret, {
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

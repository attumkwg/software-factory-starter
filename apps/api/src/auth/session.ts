import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import type { NewSession, Session } from "../env.ts";

// セッションは署名つきの HttpOnly Cookie(トークンを localStorage に置かない)。
// 中身は「誰が・どのテナントか・いつまでか・いつログインしたか」だけ。ロールは毎回 DB から引く(変更がすぐ効く)。
//   ふつう   … 「人.組織.期限.ログインした時刻」
//   代理の間 … 「社員.社員の本来の組織.期限.ログインした時刻.入室の ID.見ている組織」(docs/specs/0004-support-access.md)
//              入室が生きているか(期限・取り消し)は、認可の関所が毎回 DB で確かめる。
// 時刻は UNIX 秒。期限 = min(最後に出し直した時刻 + 無操作の上限, ログインした時刻 + 最長)(ADR 0017)。
// 使っている間は、認可の関所が出し直して期限を延ばす(refreshSession)。
// サーバー側のセッション保存(DB・Valkey)は作らない(作者 @attumkwg の決定 2026-10-20・ADR 0017)。
// 要るのは、端末を選んで切る・管理者が人を強制ログアウトさせる、が要るようになったとき。

export type SessionConfig = {
  secret: string;
  /** 無操作でこの秒数たったら切れる(既定 1時間) */
  idleSeconds: number;
  /** 使い続けても、ログインからこの秒数で切れる(既定 12時間) */
  maxSeconds: number;
  secureCookie: boolean;
};

/** 出し直してから、この秒数たつまでは出し直さない(同時のリクエストのたびに Set-Cookie を飛ばさない) */
export const REFRESH_AFTER_SECONDS = 60;
/** ログインした時刻が、これより未来なら信じない(時計のずれの許し) */
const CLOCK_SKEW_SECONDS = 60;

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const SECONDS = /^\d{1,12}$/;

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** セッションの Cookie の名前。画面のサーバー(SSR)もこの名前の Set-Cookie だけを写す */
export function sessionCookieName(cfg: Pick<SessionConfig, "secureCookie">) {
  // __Host- は Secure・Path=/・Domain なしでしか置けない(サブドメインからの上書きを防ぐ)
  return cfg.secureCookie ? "__Host-sid" : "sid";
}

export async function readSession(c: Context, cfg: SessionConfig): Promise<Session | null> {
  const raw = await getSignedCookie(c, cfg.secret, sessionCookieName(cfg));
  return raw ? parseSession(raw, cfg, nowSeconds()) : null;
}

/** Cookie の中身を読む。形が違う・切れている(無操作・最長)なら null。古い形(3つ・5つ)も null */
export function parseSession(raw: string, cfg: SessionConfig, now: number): Session | null {
  const parts = raw.split(".");
  if (parts.length !== 4 && parts.length !== 6) return null;
  const [userId = "", tenantId = "", exp = "", loggedIn = "", supportSessionId, actingTenantId] =
    parts;
  if (!UUID.test(userId) || !UUID.test(tenantId)) return null;
  if (!SECONDS.test(exp) || !SECONDS.test(loggedIn)) return null;
  const expiresAt = Number(exp);
  const loggedInAt = Number(loggedIn);
  if (expiresAt <= now) return null;
  if (loggedInAt > now + CLOCK_SKEW_SECONDS) return null;
  if (loggedInAt + cfg.maxSeconds <= now) return null;
  if (supportSessionId === undefined) return { userId, tenantId, loggedInAt, expiresAt };
  if (!UUID.test(supportSessionId) || !UUID.test(actingTenantId ?? "")) return null;
  return {
    userId,
    tenantId: actingTenantId as string,
    loggedInAt,
    expiresAt,
    support: { sessionId: supportSessionId, homeTenantId: tenantId },
  };
}

/**
 * セッションの Cookie を出す。loggedInAt を渡さなければ「いまログインした」(12時間をここから数える)。
 * ログインし直した・パスワードを入れ直した、以外では、元のセッションの loggedInAt を引き継ぐこと。
 */
export async function writeSession(c: Context, cfg: SessionConfig, s: NewSession): Promise<void> {
  const now = nowSeconds();
  const loggedInAt = s.loggedInAt ?? now;
  const exp = Math.min(now + cfg.idleSeconds, loggedInAt + cfg.maxSeconds);
  const value = s.support
    ? `${s.userId}.${s.support.homeTenantId}.${exp}.${loggedInAt}.${s.support.sessionId}.${s.tenantId}`
    : `${s.userId}.${s.tenantId}.${exp}.${loggedInAt}`;
  await setSignedCookie(c, sessionCookieName(cfg), value, cfg.secret, {
    httpOnly: true,
    secure: cfg.secureCookie,
    sameSite: "Lax",
    path: "/",
    maxAge: Math.max(exp - now, 0),
  });
}

/** 出し直して期限を延ばす時か。最長に届いている(延ばしても同じ)・出し直したばかり、なら出さない */
export function isRefreshDue(cfg: SessionConfig, s: Session, now: number): boolean {
  if (s.expiresAt >= s.loggedInAt + cfg.maxSeconds) return false;
  const issuedAt = s.expiresAt - cfg.idleSeconds;
  return now - issuedAt >= REFRESH_AFTER_SECONDS;
}

/**
 * 使っている人の期限を延ばす(認可の関所が、ハンドラーが答えた後に呼ぶ)。
 * ハンドラーが自分でセッションを出し直した(代理への切り替えなど)ときは、重ねて出さない。
 */
export async function refreshSession(c: Context, cfg: SessionConfig, s: Session): Promise<void> {
  if (!isRefreshDue(cfg, s, nowSeconds())) return;
  const name = `${sessionCookieName(cfg)}=`;
  if (c.res.headers.getSetCookie().some((h) => h.startsWith(name))) return;
  await writeSession(c, cfg, s);
}

export function clearSession(c: Context, cfg: SessionConfig): void {
  deleteCookie(c, sessionCookieName(cfg), { path: "/", secure: cfg.secureCookie });
}

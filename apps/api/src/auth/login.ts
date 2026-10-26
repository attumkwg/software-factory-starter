import type { Context } from "hono";
import { MANUAL_AUDIT_ACTIONS, recordAudit } from "../audit/index.ts";
import type { RootDb } from "../db/client.ts";
import { withTenant } from "../db/tenant.ts";
import {
  ipAllowedFor,
  ipNotAllowed,
  markMembershipUsed,
  passwordAllowedIn,
  setMfaEnabled,
  ssoRequired,
} from "../domains/organizations/index.ts";
import type { AppEnv, NewSession } from "../env.ts";
import { ApiError } from "../errors.ts";
import { clientIp } from "../http/client-ip.ts";
import type { Logger } from "../logger.ts";
import { findLogin } from "./lookup.ts";
import type { LoginIdentity } from "./providers.ts";
import { type SessionConfig, writeSession } from "./session.ts";

// ログインを終える所(開発用ログインと Cognito のログインで同じ)。

export type LoginDeps = { db: RootDb; logger: Logger; session: SessionConfig };

// どちらが違ったか(メール・パスワード・その人がいない)は言わない(画面の messages.ts の決まり 2)
export const loginFailed = () =>
  new ApiError(401, "login_failed", "メールアドレスかパスワードが正しくありません");

/**
 * users の行を引き(初めてなら確認済みのメールで結びつけ)、セッションの Cookie を発行する。
 * mfa … Cognito のログインで二段階認証のコードを聞かれたか(= Cognito で有効か)。写し(users.mfa_enabled)を合わせる。
 * 開発用ログインでは undefined(写しに触らない)。
 * SSO を必須にした組織(この人が確かめたドメインの人で、緊急用でない)には入らず、次の所属へ。どこにも入れなければ
 * 403 sso_required(設計書 0056 の 6・U-7)。
 */
export async function logIn(
  deps: LoginDeps,
  identity: LoginIdentity,
  c: Context<AppEnv>,
  opts: { mfa?: boolean } = {},
) {
  const defs = { featureFlags: c.get("featureFlags"), plans: c.get("plans") };
  const found = await findLogin(deps.db, identity, (m) =>
    withTenant(deps.db, m.tenantId, (tx) => passwordAllowedIn(tx, m.tenantId, m.userId, defs)),
  );
  if (!found.session) {
    // どの人か(メール・sub)は書かない。確認済みのメールがあったかどうかだけ
    deps.logger.warn(
      {
        kind: identity.kind,
        hasVerifiedEmail: identity.kind === "external" ? identity.verifiedEmail !== null : null,
        reason: found.refused ? "sso_required" : "no_membership",
      },
      "ログインに失敗(入れる所属が無い)",
    );
    throw found.refused ? ssoRequired() : loginFailed();
  }
  await finishLogin(deps, c, found.session, opts);
}

/**
 * 入る所属が決まった後: IP の範囲を見て、セッションの Cookie を出し、監査ログに「入った」を残す。
 * via … "sso" なら SSO で入った(セッションに印。監査ログの details.via)
 */
export async function finishLogin(
  deps: LoginDeps,
  c: Context<AppEnv>,
  session: NewSession & { linked?: boolean },
  opts: { mfa?: boolean; via?: "sso" } = {},
) {
  const { userId, tenantId } = session;
  await refuseOutsideIpAllowlist(deps, c, session);
  await writeSession(c, deps.session, { userId, tenantId, ...(opts.via ? { via: opts.via } : {}) });
  // 入った記録(監査ログ)。失敗したログインは、会社に結びつけられないのでアプリのログだけ
  await withTenant(deps.db, tenantId, async (tx) => {
    const scope = { tx, tenantId, userId };
    // 運営が Cognito で外した(認証アプリを無くした人の回復)なども、次のログインでそろう
    if (opts.mfa !== undefined) await setMfaEnabled(scope, opts.mfa);
    // 次のログインで「前回の組織」になる(docs/specs/0055-multi-org-membership.md)
    await markMembershipUsed(tx, tenantId, userId);
    await recordAudit(tx, {
      tenantId,
      actor: { kind: "user", id: userId },
      action: MANUAL_AUDIT_ACTIONS.login,
      outcome: "allowed",
      ...(opts.via ? { details: { via: opts.via } } : {}),
    });
  });
  if (session.linked) {
    deps.logger.info(
      { userId, loginTenantId: tenantId },
      "初めてのログインで、Cognito のアカウントと users の行を結びつけました",
    );
  }
  deps.logger.info({ userId, loginTenantId: tenantId, kind: opts.via ?? "password" }, "ログイン");
}

/**
 * 組織が IP の範囲を決めていて、いまの IP が外なら、セッションを出さずに 403 ip_not_allowed
 * (docs/designs/0056-sso-scim-ip-audit-export.md の 6)。断ったことは、その組織の監査ログに「拒否」で残す。
 */
async function refuseOutsideIpAllowlist(
  deps: LoginDeps,
  c: Context<AppEnv>,
  session: { tenantId: string; userId: string },
) {
  const defs = { featureFlags: c.get("featureFlags"), plans: c.get("plans") };
  const allowed = await withTenant(deps.db, session.tenantId, async (tx) => {
    if (await ipAllowedFor(tx, session.tenantId, clientIp(c), defs)) return true;
    await recordAudit(tx, {
      tenantId: session.tenantId,
      actor: { kind: "user", id: session.userId },
      action: MANUAL_AUDIT_ACTIONS.login,
      outcome: "denied",
    });
    return false;
  });
  if (allowed) return;
  deps.logger.warn(
    { userId: session.userId, loginTenantId: session.tenantId },
    "組織の IP の範囲の外からのログインを断りました",
  );
  throw ipNotAllowed();
}

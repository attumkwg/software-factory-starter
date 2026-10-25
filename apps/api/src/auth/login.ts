import type { Context } from "hono";
import { MANUAL_AUDIT_ACTIONS, recordAudit } from "../audit/index.ts";
import type { RootDb } from "../db/client.ts";
import { withTenant } from "../db/tenant.ts";
import { markMembershipUsed, setMfaEnabled } from "../domains/organizations/index.ts";
import { ApiError } from "../errors.ts";
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
 */
export async function logIn(
  deps: LoginDeps,
  identity: LoginIdentity,
  c: Context,
  opts: { mfa?: boolean } = {},
) {
  const session = await findLogin(deps.db, identity);
  if (!session) {
    // どの人か(メール・sub)は書かない。確認済みのメールがあったかどうかだけ
    deps.logger.warn(
      {
        kind: identity.kind,
        hasVerifiedEmail: identity.kind === "external" ? identity.verifiedEmail !== null : null,
      },
      "ログインに失敗(users に結びつく行が無い)",
    );
    throw loginFailed();
  }
  await writeSession(c, deps.session, session);
  // 入った記録(監査ログ)。失敗したログインは、会社に結びつけられないのでアプリのログだけ
  await withTenant(deps.db, session.tenantId, async (tx) => {
    const scope = { tx, tenantId: session.tenantId, userId: session.userId };
    // 運営が Cognito で外した(認証アプリを無くした人の回復)なども、次のログインでそろう
    if (opts.mfa !== undefined) await setMfaEnabled(scope, opts.mfa);
    // 次のログインで「前回の組織」になる(docs/specs/0055-multi-org-membership.md)
    await markMembershipUsed(tx, session.tenantId, session.userId);
    await recordAudit(tx, {
      tenantId: session.tenantId,
      actor: { kind: "user", id: session.userId },
      action: MANUAL_AUDIT_ACTIONS.login,
      outcome: "allowed",
    });
  });
  if (session.linked) {
    deps.logger.info(
      { userId: session.userId, loginTenantId: session.tenantId },
      "初めてのログインで、Cognito のアカウントと users の行を結びつけました",
    );
  }
  deps.logger.info({ userId: session.userId, loginTenantId: session.tenantId }, "ログイン");
}

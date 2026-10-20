import { otpauthUri } from "@app/shared";
import type { Context } from "hono";
import type { RootDb } from "../db/client.ts";
import type { TenantScope } from "../db/scope.ts";
import { withTenant } from "../db/tenant.ts";
import {
  confirmEmailChange,
  endOtherSessions,
  findPendingEmailChange,
  getAccount,
  isEmailInUse,
  requestEmailChange,
  setMfaEnabled,
} from "../domains/organizations/index.ts";
import type { AppEnv } from "../env.ts";
import { ApiError, badRequest, unauthorized } from "../errors.ts";
import { createRouter } from "../http/common.ts";
import type { Logger } from "../logger.ts";
import { enqueue, type OutboxPayload, type OutboxTopic } from "../outbox/index.ts";
import {
  changeEmailRoute,
  changePasswordRoute,
  confirmEmailRoute,
  getAccountRoute,
  mfaDisableRoute,
  mfaEnableRoute,
  mfaSetupRoute,
  reauthRoute,
} from "./account-openapi.ts";
import { CognitoAccount, MfaCodeRequired } from "./cognito-account.ts";
import { type CognitoClient, CognitoError } from "./providers.ts";
import { clearReauth, readReauth, writeReauth } from "./reauth.ts";
import { type SessionConfig, writeSession } from "./session.ts";

// 本人のアカウント(docs/specs/0006-account-security.md・設計書の 3)。
// 関所は、この API ではトランザクションを閉じてから呼ぶ(policy.ts の OUTSIDE_TRANSACTION)。
// Cognito を待つ間に DB のトランザクションを開かないため、DB は Cognito の前後で短い withTenant を開く。
// パスワード・コード・鍵・アクセストークン・メールはログに出さない(理由の名前だけ)。

type Deps = { db: RootDb; logger: Logger; session: SessionConfig; cognito: CognitoClient };
type Ctx = Context<AppEnv>;

const reauthFailed = () =>
  new ApiError(400, "reauth_failed", "パスワードかコードが正しくありません");
const reauthRequired = () =>
  new ApiError(400, "reauth_required", "もう一度パスワードを入れてください");
const invalidCode = () => new ApiError(400, "invalid_code", "コードが違うか、期限が切れています");
const emailUnavailable = () =>
  new ApiError(409, "email_unavailable", "このメールアドレスには変えられません");

/** Cognito の断りを、画面に返す失敗に直す(何をしていたかで変わる所は呼ぶ側で) */
function toAccountError(e: CognitoError, what: string): ApiError {
  switch (e.type) {
    case "CodeMismatchException":
    case "ExpiredCodeException":
    case "EnableSoftwareTokenMFAException":
      return what === "reauth" ? reauthFailed() : invalidCode();
    case "InvalidPasswordException":
      return new ApiError(400, "invalid_password", "パスワードが決まりを満たしていません");
    case "AliasExistsException":
      return emailUnavailable();
    case "NotAuthorizedException":
      // 確かめ直しのパスワード違い・札(アクセストークン)が切れた・無効にされた
      return what === "reauth" ? reauthFailed() : reauthRequired();
    default:
      return new ApiError(400, "bad_request", "入力が正しくありません");
  }
}

/** 本人のアカウントの API が使い回す手順(Cognito への問い合わせ・短いトランザクション・変更の終え方) */
class AccountFlow {
  readonly idp: CognitoAccount;
  readonly #deps: Deps;

  constructor(deps: Deps) {
    this.#deps = deps;
    this.idp = new CognitoAccount(deps.cognito);
  }

  /** Cognito を呼び、断られたら画面に返す失敗に直す(理由の名前だけログに) */
  async ask<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      this.fail(what, e);
    }
  }

  /** 失敗を画面に返す形に直して投げる(Cognito の断りでなければ、そのまま投げる) */
  fail(what: string, e: unknown): never {
    if (e instanceof MfaCodeRequired) {
      throw new ApiError(400, "mfa_code_required", "二段階認証のコードも入れてください");
    }
    if (!(e instanceof CognitoError)) throw e;
    this.#deps.logger.warn({ what, reason: e.type }, "Cognito が断りました");
    throw toAccountError(e, what);
  }

  /** 本人の文脈で、短いトランザクションを開く(関所はこの API ではトランザクションを開いたままにしない) */
  inTenant<T>(c: Ctx, fn: (s: TenantScope) => Promise<T>): Promise<T> {
    const { tenantId, userId } = c.get("actor");
    return withTenant(this.#deps.db, tenantId, (tx) => fn({ tx, tenantId, userId }));
  }

  async accountOf(c: Ctx) {
    const account = await this.inTenant(c, getAccount);
    if (!account) throw unauthorized();
    return account;
  }

  /** パスワード(とコード)を確かめ直し、二段階認証の写しを Cognito に合わせる */
  async reauthenticate(c: Ctx, password: string, code?: string) {
    const { email } = await this.accountOf(c);
    const r = await this.ask("reauth", () => this.idp.reauthenticate(email, password, code));
    await this.inTenant(c, (s) => setMfaEnabled(s, r.mfa));
    return r;
  }

  rememberReauth(c: Ctx, accessToken: string) {
    writeReauth(c, this.#deps.session, { userId: c.get("actor").userId, accessToken });
  }

  /** 確かめ直しの札(10分)。無い・切れた・本人違いなら 400 reauth_required */
  reauthOf(c: Ctx) {
    const r = readReauth(c, this.#deps.session, c.get("actor").userId);
    if (!r) throw reauthRequired();
    return r;
  }

  logger() {
    return this.#deps.logger;
  }

  /**
   * 変更を終える: ほかの端末を切り・お知らせを積み(同じトランザクション)、この端末には新しいセッションを出す
   * (パスワードを入れ直したので、ログインし直したのと同じ扱い。12時間もここから)。Cognito のトークンは無効にする。
   */
  async finish<T extends OutboxTopic>(
    c: Ctx,
    accessToken: string,
    notice: { topic: T; payload: OutboxPayload<T> },
    change?: (s: TenantScope) => Promise<void>,
  ) {
    const now = new Date();
    await this.inTenant(c, async (s) => {
      await change?.(s);
      await endOtherSessions(s, now);
      await enqueue(s, notice.topic, notice.payload);
    });
    const { userId, tenantId } = c.get("actor");
    const loggedInAt = Math.floor(now.getTime() / 1000);
    await writeSession(c, this.#deps.session, { userId, tenantId, loggedInAt });
    clearReauth(c, this.#deps.session);
    await this.idp.signOutEverywhere(accessToken).catch((err: unknown) => {
      // 変更は済んでいる。トークンは15分で切れるので、失敗しても止めない
      this.#deps.logger.warn({ err }, "Cognito のトークンを無効にできませんでした");
    });
    return c.body(null, 204);
  }
}

export function accountRoutes(deps: Deps) {
  const flow = new AccountFlow(deps);
  const router = createRouter()
    .openapi(getAccountRoute, async (c) => c.json(await flow.accountOf(c), 200))
    .openapi(reauthRoute, async (c) => {
      const { password, code } = c.req.valid("json");
      const r = await flow.reauthenticate(c, password, code);
      flow.rememberReauth(c, r.accessToken);
      return c.json({ ok: true as const }, 200);
    })
    .openapi(changePasswordRoute, async (c) => {
      const { currentPassword, newPassword, code } = c.req.valid("json");
      const r = await flow.reauthenticate(c, currentPassword, code);
      await flow.ask("change_password", () =>
        flow.idp.changePassword(r.accessToken, currentPassword, newPassword),
      );
      const userId = c.get("actor").userId;
      return flow.finish(c, r.accessToken, {
        topic: "organizations.password_changed",
        payload: { userId },
      });
    });
  addEmailRoutes(router, flow);
  addMfaRoutes(router, flow);
  return router;
}

type Router = ReturnType<typeof createRouter>;

/** メールの変更: 申し込み(新しいアドレスに確認コード)→ 確認(替えて、古いアドレスに知らせる) */
function addEmailRoutes(router: Router, flow: AccountFlow) {
  router
    .openapi(changeEmailRoute, async (c) => {
      const { accessToken } = flow.reauthOf(c);
      const newEmail = c.req.valid("json").newEmail.toLowerCase();
      const { email } = await flow.accountOf(c);
      if (newEmail === email) throw badRequest("いまと同じメールアドレスです");
      try {
        await flow.idp.requestEmailChange(accessToken, newEmail);
      } catch (e) {
        if (!(e instanceof CognitoError) || e.type !== "AliasExistsException") {
          flow.fail("request_email_change", e);
        }
        // 使われているアドレスでも同じ答え(確認コードは届かない。言うのは確認の時点で、持ち主にだけ)
        flow.logger().info({ what: "request_email_change" }, "使われているアドレスへの申し込み");
      }
      await flow.inTenant(c, (s) => requestEmailChange(s, { previousEmail: email, newEmail }));
      return c.json({ next: "confirm" as const }, 202);
    })
    .openapi(confirmEmailRoute, async (c) => {
      const { accessToken } = flow.reauthOf(c);
      const pending = await flow.inTenant(c, findPendingEmailChange);
      if (!pending) throw invalidCode();
      const userId = c.get("actor").userId;
      // そのアドレスの持ち主(確認コードを受け取れる人)にだけ「使われている」が分かるよう、確認の時点で確かめる
      const taken = await flow.inTenant(c, (s) => isEmailInUse(s.tx, pending.newEmail, userId));
      if (taken) throw emailUnavailable();
      await flow.ask("confirm_email_change", () =>
        flow.idp.confirmEmailChange(accessToken, c.req.valid("json").code),
      );
      const notice = {
        topic: "organizations.email_changed" as const,
        payload: { emailChangeId: pending.id },
      };
      return flow.finish(c, accessToken, notice, async (s) => {
        if (await confirmEmailChange(s, pending)) return;
        // 確かめと確認の間に、同じアドレスの行が足された。Cognito はもう替わっている(手順書で直す)
        flow
          .logger()
          .error({ userId }, "Cognito のメールは替わったが、users の更新がぶつかりました");
        throw emailUnavailable();
      });
    });
}

/** 二段階認証: 鍵を作る → コードで有効に / パスワード+コードで外す */
function addMfaRoutes(router: Router, flow: AccountFlow) {
  router
    .openapi(mfaSetupRoute, async (c) => {
      const { accessToken } = flow.reauthOf(c);
      const { email, mfaEnabled } = await flow.accountOf(c);
      if (mfaEnabled) throw new ApiError(409, "mfa_already_enabled", "二段階認証はもう有効です");
      const secret = await flow.ask("associate_totp", () => flow.idp.associateTotp(accessToken));
      return c.json({ secret, otpauthUri: otpauthUri(email, secret) }, 200);
    })
    .openapi(mfaEnableRoute, async (c) => {
      const { accessToken } = flow.reauthOf(c);
      const { code } = c.req.valid("json");
      await flow.ask("enable_totp", () => flow.idp.enableTotp(accessToken, code));
      const notice = {
        topic: "organizations.mfa_enabled" as const,
        payload: { userId: c.get("actor").userId },
      };
      return flow.finish(c, accessToken, notice, (s) => setMfaEnabled(s, true));
    })
    .openapi(mfaDisableRoute, async (c) => {
      const account = await flow.accountOf(c);
      if (account.organizationRequiresMfa) {
        throw new ApiError(403, "mfa_required_by_organization", "組織が必須にしています");
      }
      if (!account.mfaEnabled) {
        throw new ApiError(409, "mfa_not_enabled", "二段階認証はまだ有効ではありません");
      }
      const { password, code } = c.req.valid("json");
      const r = await flow.reauthenticate(c, password, code);
      await flow.ask("disable_totp", () => flow.idp.disableTotp(r.accessToken));
      const notice = {
        topic: "organizations.mfa_disabled" as const,
        payload: { userId: c.get("actor").userId },
      };
      return flow.finish(c, r.accessToken, notice, (s) => setMfaEnabled(s, false));
    });
}

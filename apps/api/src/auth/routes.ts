import {
  AuthNextSchema,
  AuthOptionsSchema,
  ConfirmSignUpSchema,
  DevLoginSchema,
  ForgotPasswordSchema,
  LoginSchema,
  MfaSchema,
  ResendCodeSchema,
  ResetPasswordSchema,
  SignUpSchema,
} from "@app/shared";
import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { MANUAL_AUDIT_ACTIONS, recordAudit } from "../audit/index.ts";
import type { RootDb } from "../db/client.ts";
import { withTenant } from "../db/tenant.ts";
import { ApiError } from "../errors.ts";
import { bodyErrors, createRouter, json, jsonBody } from "../http/common.ts";
import type { Logger } from "../logger.ts";
import { findLogin } from "./lookup.ts";
import { takePendingMfa, writePendingMfa } from "./pending-mfa.ts";
import {
  type AuthResult,
  CognitoClient,
  CognitoError,
  type CognitoSettings,
  type LoginIdentity,
} from "./providers.ts";
import { clearSession, type SessionConfig, writeSession } from "./session.ts";

type Deps = {
  db: RootDb;
  logger: Logger;
  session: SessionConfig;
  auth: ({ mode: "dev" } | ({ mode: "cognito" } & CognitoSettings)) & {
    /** テスト用: 偽物の Cognito につないだ物に差し替える */
    cognito?: CognitoClient;
  };
};

const LoggedIn = json(z.object({ ok: z.literal(true) }), "ログインした(Cookie を返す)");
const Next = json(AuthNextSchema, "次にすること(done ならログインした。Cookie を返す)");
const errorBody = (description: string) => json(z.any(), description);

// どちらが違ったか(メール・パスワード・その人がいない)は言わない(画面の messages.ts の決まり 2)
const loginFailed = () =>
  new ApiError(401, "login_failed", "メールアドレスかパスワードが正しくありません");
const invalidCode = () => new ApiError(400, "invalid_code", "コードが違うか、期限が切れています");
const invalidPassword = () =>
  new ApiError(400, "invalid_password", "パスワードが決まりを満たしていません");

/**
 * Cognito が断った理由を、画面に返す失敗に直す。理由の名前はログに残す(中身・メール・パスワードは残さない)。
 * 「その人はいない」は「パスワードが違う」と同じにする(アカウントの列挙を防ぐ。Cognito の prevent_user_existence_errors と同じ考え)。
 */
function toAuthError(e: CognitoError): ApiError {
  switch (e.type) {
    case "CodeMismatchException":
    case "ExpiredCodeException":
      return invalidCode();
    case "InvalidPasswordException":
      return invalidPassword();
    case "InvalidParameterException":
      return new ApiError(400, "bad_request", "入力が正しくありません");
    default:
      // NotAuthorizedException・UserNotFoundException・PasswordResetRequiredException・未対応の関門 など
      return loginFailed();
  }
}

export function authRoutes(deps: Deps) {
  const cognito =
    deps.auth.mode === "cognito" ? (deps.auth.cognito ?? new CognitoClient(deps.auth)) : null;

  /** users の行を引き(初めてなら確認済みのメールで結びつけ)、セッションの Cookie を発行する */
  async function login(identity: LoginIdentity, c: Context) {
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
    await withTenant(deps.db, session.tenantId, (tx) =>
      recordAudit(tx, {
        tenantId: session.tenantId,
        actor: { kind: "user", id: session.userId },
        action: MANUAL_AUDIT_ACTIONS.login,
        outcome: "allowed",
      }),
    );
    if (session.linked) {
      deps.logger.info(
        { userId: session.userId, loginTenantId: session.tenantId },
        "初めてのログインで、Cognito のアカウントと users の行を結びつけました",
      );
    }
    deps.logger.info({ userId: session.userId, loginTenantId: session.tenantId }, "ログイン");
  }

  /** Cognito を呼び、断られたら画面に返す失敗に直す(理由はログに) */
  async function ask<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof CognitoError)) throw e;
      deps.logger.warn({ what, reason: e.type }, "Cognito が断りました");
      throw toAuthError(e);
    }
  }

  const router = createRouter()
    .openapi(
      createRoute({
        method: "post",
        path: "/auth/logout",
        tags: ["auth"],
        summary: "ログアウト",
        description:
          "Cookie を消す。そのあと GET /api/auth/options の logoutUrl(ログイン画面)へ移る",
        responses: { 204: { description: "Cookie を消した" } },
      }),
      async (c) => {
        const session = c.get("session");
        clearSession(c, deps.session);
        // ログアウトは必ず成功させる(記録に失敗しても Cookie は消してある)
        if (session) {
          await withTenant(deps.db, session.tenantId, (tx) =>
            recordAudit(tx, {
              tenantId: session.tenantId,
              actor: { kind: "user", id: session.userId },
              action: MANUAL_AUDIT_ACTIONS.logout,
              outcome: "allowed",
            }),
          ).catch((err) => deps.logger.warn({ err }, "ログアウトの監査ログを残せませんでした"));
        }
        return c.body(null, 204);
      },
    )
    .openapi(
      createRoute({
        method: "get",
        path: "/auth/options",
        tags: ["auth"],
        summary: "ログインの方式(画面がログインとログアウトの出し方を決める)",
        responses: { 200: json(AuthOptionsSchema, "方式") },
      }),
      (c) =>
        c.json(
          cognito
            ? { method: "cognito" as const, logoutUrl: cognito.logoutUrl }
            : { method: "dev" as const },
          200,
        ),
    );

  if (!cognito) {
    // 開発用ログイン。config.ts が local / test / preview 以外では起動させない。
    router.openapi(
      createRoute({
        method: "post",
        path: "/auth/dev-login",
        tags: ["auth"],
        summary: "【開発環境だけ】メールアドレスだけでログイン",
        request: { body: jsonBody(DevLoginSchema) },
        responses: { 200: LoggedIn, ...bodyErrors, 401: errorBody("いない") },
      }),
      async (c) => {
        await login({ kind: "email", email: c.req.valid("json").email }, c);
        return c.json({ ok: true as const }, 200);
      },
    );
    return router;
  }

  // ここから下は Cognito のときだけ(上で dev は返した)
  const idp = cognito;

  /** ログインの結果に合わせて、Cookie を出すか・二段階認証を待つか・確認コードへ回すか */
  async function finish(result: AuthResult, email: string, c: Context) {
    if (result.kind === "mfa") {
      await writePendingMfa(c, deps.session, { session: result.session, email });
      return c.json({ next: "mfa" as const }, 200);
    }
    if (result.kind === "not_confirmed") {
      // 確認コードを送り直して、確認の画面へ(パスワードが合っている本人なので、伝えてよい)
      await ask("resend_code", () => idp.resendCode(email));
      return c.json({ next: "confirm" as const }, 200);
    }
    await login(result.identity, c);
    return c.json({ next: "done" as const }, 200);
  }

  const authFailures = {
    ...bodyErrors,
    401: errorBody("メールアドレスかパスワードが正しくない(どちらかは言わない)"),
    429: errorBody("試しすぎ。少し待つ"),
  };

  router
    .openapi(
      createRoute({
        method: "post",
        path: "/auth/login",
        tags: ["auth"],
        summary: "メールアドレスとパスワードでログイン",
        request: { body: jsonBody(LoginSchema) },
        responses: { 200: Next, ...authFailures },
      }),
      async (c) => {
        const { email, password } = c.req.valid("json");
        const result = await ask("sign_in", () => cognito.signIn(email, password));
        return finish(result, email, c);
      },
    )
    .openapi(
      createRoute({
        method: "post",
        path: "/auth/mfa",
        tags: ["auth"],
        summary: "二段階認証のコードを返して、ログインを終える",
        request: { body: jsonBody(MfaSchema) },
        responses: { 200: Next, ...authFailures },
      }),
      async (c) => {
        const pending = await takePendingMfa(c, deps.session);
        // 途中の状態が無い・切れた → 最初から(ログイン画面へ)
        if (!pending) throw loginFailed();
        const { code } = c.req.valid("json");
        try {
          const result = await cognito.answerMfa(pending.email, pending.session, code);
          return await finish(result, pending.email, c);
        } catch (e) {
          if (!(e instanceof CognitoError)) throw e;
          deps.logger.warn({ what: "mfa", reason: e.type }, "Cognito が断りました");
          // Cognito の札は1回きり。コードが違っても、パスワードからやり直す
          throw e.type === "CodeMismatchException" ? invalidCode() : loginFailed();
        }
      },
    )
    .openapi(
      createRoute({
        method: "post",
        path: "/auth/sign-up",
        tags: ["auth"],
        summary: "登録(確認コードのメールが届く)",
        request: { body: jsonBody(SignUpSchema) },
        responses: { 200: Next, ...authFailures },
      }),
      async (c) => {
        const { email, password } = c.req.valid("json");
        try {
          await cognito.signUp(email, password);
        } catch (e) {
          // もう登録されている人にも同じ答えを返す(登録の有無を確かめる手がかりにしない)。メールは送られない
          if (!(e instanceof CognitoError) || e.type !== "UsernameExistsException") {
            if (e instanceof CognitoError) {
              deps.logger.warn({ what: "sign_up", reason: e.type }, "Cognito が断りました");
              throw toAuthError(e);
            }
            throw e;
          }
          deps.logger.info({ what: "sign_up" }, "登録済みのメールでの登録(同じ答えを返す)");
        }
        return c.json({ next: "confirm" as const }, 200);
      },
    )
    .openapi(
      createRoute({
        method: "post",
        path: "/auth/confirm-sign-up",
        tags: ["auth"],
        summary: "登録の確認コードを入れる",
        request: { body: jsonBody(ConfirmSignUpSchema) },
        responses: { 200: Next, ...authFailures },
      }),
      async (c) => {
        const { email, code } = c.req.valid("json");
        await ask("confirm_sign_up", () => cognito.confirmSignUp(email, code));
        return c.json({ next: "login" as const }, 200);
      },
    )
    .openapi(
      createRoute({
        method: "post",
        path: "/auth/resend-code",
        tags: ["auth"],
        summary: "登録の確認コードを送り直す(いない人にも同じ答え)",
        request: { body: jsonBody(ResendCodeSchema) },
        responses: { 200: Next, ...authFailures },
      }),
      async (c) => {
        const { email } = c.req.valid("json");
        try {
          await cognito.resendCode(email);
        } catch (e) {
          if (!(e instanceof CognitoError)) throw e;
          // いない・もう確認済み、も同じ答え(列挙を防ぐ)
          deps.logger.info({ what: "resend_code", reason: e.type }, "確認コードを送りませんでした");
        }
        return c.json({ next: "confirm" as const }, 200);
      },
    )
    .openapi(
      createRoute({
        method: "post",
        path: "/auth/forgot-password",
        tags: ["auth"],
        summary: "パスワードの再設定のコードを送る(いない人にも同じ答え)",
        request: { body: jsonBody(ForgotPasswordSchema) },
        responses: { 200: Next, ...authFailures },
      }),
      async (c) => {
        const { email } = c.req.valid("json");
        try {
          await cognito.forgotPassword(email);
        } catch (e) {
          if (!(e instanceof CognitoError)) throw e;
          deps.logger.info(
            { what: "forgot_password", reason: e.type },
            "再設定のコードを送りませんでした",
          );
        }
        return c.json({ next: "confirm" as const }, 200);
      },
    )
    .openapi(
      createRoute({
        method: "post",
        path: "/auth/reset-password",
        tags: ["auth"],
        summary: "再設定のコードと新しいパスワードを入れる",
        request: { body: jsonBody(ResetPasswordSchema) },
        responses: { 200: Next, ...authFailures },
      }),
      async (c) => {
        const { email, code, password } = c.req.valid("json");
        await ask("reset_password", () => cognito.resetPassword(email, code, password));
        return c.json({ next: "login" as const }, 200);
      },
    );
  return router;
}

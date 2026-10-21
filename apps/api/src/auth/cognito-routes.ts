import {
  AuthNextSchema,
  ConfirmSignUpSchema,
  ForgotPasswordSchema,
  LoginSchema,
  MfaSchema,
  ResendCodeSchema,
  ResetPasswordSchema,
  SignUpSchema,
} from "@app/shared";
import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { ApiError } from "../errors.ts";
import { bodyErrors, type createRouter, json, jsonBody } from "../http/common.ts";
import type { Logger } from "../logger.ts";
import { type LoginDeps, logIn, loginFailed } from "./login.ts";
import { takePendingMfa, writePendingMfa } from "./pending-mfa.ts";
import { type AuthResult, type CognitoClient, CognitoError } from "./providers.ts";
import { recordSignUpConsents } from "./sign-up-consent.ts";

// Cognito のときだけの入口: ログイン・二段階認証・登録・確認コード・パスワードの再設定。

type Router = ReturnType<typeof createRouter>;

const Next = json(AuthNextSchema, "次にすること(done ならログインした。Cookie を返す)");
const errorBody = (description: string) => json(z.any(), description);
const authFailures = {
  ...bodyErrors,
  401: errorBody("メールアドレスかパスワードが正しくない(どちらかは言わない)"),
  429: errorBody("試しすぎ。少し待つ"),
};

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

/** Cognito を呼び、断られたら画面に返す失敗に直す(理由はログに) */
async function ask<T>(logger: Logger, what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof CognitoError)) throw e;
    logger.warn({ what, reason: e.type }, "Cognito が断りました");
    throw toAuthError(e);
  }
}

/** Cognito を呼び、断られても同じ答えにする(いない人・確認済みの人を見分けさせない)。理由はログに */
async function quietly(logger: Logger, what: string, message: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof CognitoError)) throw e;
    logger.info({ what, reason: e.type }, message);
  }
}

// ── 入口の形(OpenAPI) ─────────────────────────────────────────────────────

const authRoute = <S extends z.ZodType>(path: string, summary: string, body: S) =>
  createRoute({
    method: "post",
    path,
    tags: ["auth"],
    summary,
    request: { body: jsonBody(body) },
    responses: { 200: Next, ...authFailures },
  });

const loginRoute = authRoute("/auth/login", "メールアドレスとパスワードでログイン", LoginSchema);
const mfaRoute = authRoute("/auth/mfa", "二段階認証のコードを返して、ログインを終える", MfaSchema);
const signUpRoute = authRoute("/auth/sign-up", "登録(確認コードのメールが届く)", SignUpSchema);
const confirmSignUpRoute = authRoute(
  "/auth/confirm-sign-up",
  "登録の確認コードを入れる",
  ConfirmSignUpSchema,
);
const resendCodeRoute = authRoute(
  "/auth/resend-code",
  "登録の確認コードを送り直す(いない人にも同じ答え)",
  ResendCodeSchema,
);
const forgotPasswordRoute = authRoute(
  "/auth/forgot-password",
  "パスワードの再設定のコードを送る(いない人にも同じ答え)",
  ForgotPasswordSchema,
);
const resetPasswordRoute = authRoute(
  "/auth/reset-password",
  "再設定のコードと新しいパスワードを入れる",
  ResetPasswordSchema,
);

// ── 入口 ───────────────────────────────────────────────────────────────────

export function addCognitoRoutes(router: Router, deps: LoginDeps, idp: CognitoClient) {
  addSignInRoutes(router, deps, idp);
  addAccountRoutes(router, deps, idp);
}

/** ログインと二段階認証 */
function addSignInRoutes(router: Router, deps: LoginDeps, idp: CognitoClient) {
  /** ログインの結果に合わせて、Cookie を出すか・二段階認証を待つか・確認コードへ回すか */
  async function finish(result: AuthResult, email: string, c: Context, viaMfa = false) {
    if (result.kind === "mfa") {
      await writePendingMfa(c, deps.session, { session: result.session, email });
      return c.json({ next: "mfa" as const }, 200);
    }
    if (result.kind === "not_confirmed") {
      // 確認コードを送り直して、確認の画面へ(パスワードが合っている本人なので、伝えてよい)
      await ask(deps.logger, "resend_code", () => idp.resendCode(email));
      return c.json({ next: "confirm" as const }, 200);
    }
    await logIn(deps, result.identity, c, { mfa: viaMfa });
    return c.json({ next: "done" as const }, 200);
  }

  router
    .openapi(loginRoute, async (c) => {
      const { email, password } = c.req.valid("json");
      const result = await ask(deps.logger, "sign_in", () => idp.signIn(email, password));
      return finish(result, email, c);
    })
    .openapi(mfaRoute, async (c) => {
      const pending = await takePendingMfa(c, deps.session);
      // 途中の状態が無い・切れた → 最初から(ログイン画面へ)
      if (!pending) throw loginFailed();
      const { code } = c.req.valid("json");
      try {
        const result = await idp.answerMfa(pending.email, pending.session, code);
        return await finish(result, pending.email, c, true);
      } catch (e) {
        if (!(e instanceof CognitoError)) throw e;
        deps.logger.warn({ what: "mfa", reason: e.type }, "Cognito が断りました");
        // Cognito の札は1回きり。コードが違っても、パスワードからやり直す
        throw e.type === "CodeMismatchException" ? invalidCode() : loginFailed();
      }
    });
}

/** 登録・確認コード・パスワードの再設定 */
function addAccountRoutes(router: Router, deps: LoginDeps, idp: CognitoClient) {
  const { logger } = deps;
  router
    .openapi(signUpRoute, async (c) => {
      const { email, password } = c.req.valid("json");
      try {
        await idp.signUp(email, password);
      } catch (e) {
        // もう登録されている人にも同じ答えを返す(登録の有無を確かめる手がかりにしない)。メールは送られない
        if (!(e instanceof CognitoError)) throw e;
        if (e.type !== "UsernameExistsException") {
          logger.warn({ what: "sign_up", reason: e.type }, "Cognito が断りました");
          throw toAuthError(e);
        }
        logger.info({ what: "sign_up" }, "登録済みのメールでの登録(同じ答えを返す)");
      }
      return c.json({ next: "confirm" as const }, 200);
    })
    .openapi(confirmSignUpRoute, async (c) => {
      const { email, code, consents } = c.req.valid("json");
      await ask(logger, "confirm_sign_up", () => idp.confirmSignUp(email, code));
      // 確認コードが通った(メールの持ち主)後でだけ、登録の画面で同意した版を記録する
      await recordSignUpConsents(deps, c, email, consents);
      return c.json({ next: "login" as const }, 200);
    })
    .openapi(resendCodeRoute, async (c) => {
      const { email } = c.req.valid("json");
      // いない・もう確認済み、も同じ答え(列挙を防ぐ)
      await quietly(logger, "resend_code", "確認コードを送りませんでした", () =>
        idp.resendCode(email),
      );
      return c.json({ next: "confirm" as const }, 200);
    })
    .openapi(forgotPasswordRoute, async (c) => {
      const { email } = c.req.valid("json");
      await quietly(logger, "forgot_password", "再設定のコードを送りませんでした", () =>
        idp.forgotPassword(email),
      );
      return c.json({ next: "confirm" as const }, 200);
    })
    .openapi(resetPasswordRoute, async (c) => {
      const { email, code, password } = c.req.valid("json");
      await ask(logger, "reset_password", () => idp.resetPassword(email, code, password));
      return c.json({ next: "login" as const }, 200);
    });
}

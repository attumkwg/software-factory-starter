import {
  AccountCodeSchema,
  AccountSchema,
  ChangeEmailSchema,
  ChangePasswordSchema,
  DisableMfaSchema,
  EmailChangeRequestedSchema,
  MfaSetupSchema,
  ReauthSchema,
} from "@app/shared";
import { createRoute, z } from "@hono/zod-openapi";
import {
  authErrors,
  badRequestError,
  bodyErrors,
  conflictError,
  json,
  jsonBody,
} from "../http/common.ts";

// 本人のアカウントの API の形(docs/specs/0006-account-security.md)。中身は account-routes.ts。
// どれも対象はセッションの本人だけ(パスに人の ID を取らない)。Cognito のときだけある。代理の最中は 403。

const tags = ["account"];
const throttled = { 429: json(z.any(), "試しすぎ。少し待つ") };
const done = {
  204: { description: "変えた(この端末には新しいセッションの Cookie。ほかの端末は切れる)" },
};

export const getAccountRoute = createRoute({
  method: "get",
  path: "/account",
  tags,
  summary: "本人のアカウントの状態(メール・二段階認証・申し込み中のメール・組織の必須)",
  responses: { 200: json(AccountSchema, "本人の状態"), ...authErrors },
});

export const reauthRoute = createRoute({
  method: "post",
  path: "/account/reauth",
  tags,
  summary:
    "パスワード(と、有効なら二段階認証のコード)を入れ直す。二段階認証の設定・メールの変更の前に(札は10分)",
  request: { body: jsonBody(ReauthSchema) },
  responses: {
    200: json(z.object({ ok: z.literal(true) }), "確かめた(確かめ直しの札の Cookie を返す)"),
    ...bodyErrors,
    ...authErrors,
    ...throttled,
  },
});

export const changePasswordRoute = createRoute({
  method: "post",
  path: "/account/password",
  tags,
  summary: "パスワードを変える(いまのパスワードと、有効なら二段階認証のコードも)",
  request: { body: jsonBody(ChangePasswordSchema) },
  responses: { ...done, ...bodyErrors, ...authErrors, ...throttled },
});

export const changeEmailRoute = createRoute({
  method: "post",
  path: "/account/email",
  tags,
  summary: "メールの変更を申し込む(新しいアドレスに確認コードが届く。確かめ直しの札が要る)",
  request: { body: jsonBody(ChangeEmailSchema) },
  responses: {
    202: json(EmailChangeRequestedSchema, "申し込んだ(使われているアドレスでも同じ答え)"),
    ...bodyErrors,
    ...authErrors,
    ...throttled,
  },
});

export const confirmEmailRoute = createRoute({
  method: "post",
  path: "/account/email/confirm",
  tags,
  summary: "新しいアドレスに届いた確認コードを入れて、メールを替える(古いアドレスにお知らせ)",
  request: { body: jsonBody(AccountCodeSchema) },
  responses: { ...done, ...bodyErrors, ...authErrors, ...conflictError, ...throttled },
});

export const mfaSetupRoute = createRoute({
  method: "post",
  path: "/account/mfa/setup",
  tags,
  summary: "二段階認証の鍵を作る(QR と手で入れる鍵。確かめ直しの札が要る)",
  responses: {
    200: json(MfaSetupSchema, "鍵(ログに出さない・画面はブラウザの中で QR を描く)"),
    ...badRequestError,
    ...authErrors,
    ...conflictError,
  },
});

export const mfaEnableRoute = createRoute({
  method: "post",
  path: "/account/mfa/enable",
  tags,
  summary: "認証アプリのコードで、二段階認証を有効にする(確かめ直しの札が要る)",
  request: { body: jsonBody(AccountCodeSchema) },
  responses: { ...done, ...bodyErrors, ...authErrors, ...throttled },
});

export const mfaDisableRoute = createRoute({
  method: "post",
  path: "/account/mfa/disable",
  tags,
  summary: "二段階認証を外す(パスワードといまのコード。組織が必須なら 403)",
  request: { body: jsonBody(DisableMfaSchema) },
  responses: { ...done, ...bodyErrors, ...authErrors, ...conflictError, ...throttled },
});

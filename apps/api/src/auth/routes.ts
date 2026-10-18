import { AuthOptionsSchema, DevLoginSchema, safeReturnTo } from "@app/shared";
import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { RootDb } from "../db/client.ts";
import { ApiError, toApiError } from "../errors.ts";
import { bodyErrors, createRouter, json, jsonBody } from "../http/common.ts";
import type { Logger } from "../logger.ts";
import { findLogin } from "./lookup.ts";
import { takePendingLogin, writePendingLogin } from "./pending-login.ts";
import {
  CognitoClient,
  CognitoRejected,
  type CognitoSettings,
  type LoginIdentity,
  randomToken,
  sameSecret,
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
const loginFailed = () => new ApiError(401, "login_failed", "ログインできませんでした");

/** ブラウザのページの移動で来る入口(login・callback)の失敗は、JSON ではなくログイン画面へ戻して伝える */
type LoginPageError = "login_failed" | "service_unavailable" | "internal";
const toLoginPage = (c: Context, error: LoginPageError) => c.redirect(`/login?error=${error}`, 302);

export function authRoutes(deps: Deps) {
  async function login(identity: LoginIdentity, c: Context) {
    const session = await findLogin(deps.db, identity);
    if (!session) {
      // どの人か(メール・sub)は書かない。確認済みのメールがあったかどうかだけ
      deps.logger.warn(
        {
          kind: identity.kind,
          hasVerifiedEmail: identity.kind === "external" ? identity.verifiedEmail !== null : null,
        },
        "ログインに失敗",
      );
      throw loginFailed();
    }
    await writeSession(c, deps.session, session);
    if (session.linked) {
      deps.logger.info(
        { userId: session.userId, loginTenantId: session.tenantId },
        "初めてのログインで、Cognito のアカウントと users の行を結びつけました",
      );
    }
    deps.logger.info({ userId: session.userId, loginTenantId: session.tenantId }, "ログイン");
  }

  const cognito =
    deps.auth.mode === "cognito" ? (deps.auth.cognito ?? new CognitoClient(deps.auth)) : null;

  const router = createRouter()
    .openapi(
      createRoute({
        method: "post",
        path: "/auth/logout",
        tags: ["auth"],
        summary: "ログアウト",
        description:
          "Cookie を消す。Cognito のときは、続けて GET /api/auth/options の logoutUrl へ移ると Cognito 側のログインも終わる",
        responses: { 204: { description: "Cookie を消した" } },
      }),
      (c) => {
        clearSession(c, deps.session);
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
        responses: { 200: LoggedIn, ...bodyErrors, 401: json(z.any(), "いない") },
      }),
      async (c) => {
        await login({ kind: "email", email: c.req.valid("json").email }, c);
        return c.json({ ok: true as const }, 200);
      },
    );
    return router;
  }

  router
    .openapi(
      createRoute({
        method: "get",
        path: "/auth/login",
        tags: ["auth"],
        summary: "Cognito の画面へ移る(ブラウザのページの移動で使う)",
        request: { query: z.object({ returnTo: z.string().optional() }) },
        responses: { 302: { description: "Cognito の画面へ" } },
      }),
      async (c) => {
        const pending = {
          state: randomToken(),
          nonce: randomToken(),
          codeVerifier: randomToken(),
          returnTo: safeReturnTo(c.req.valid("query").returnTo),
        };
        await writePendingLogin(c, deps.session, pending);
        return c.redirect(cognito.authorizeUrl(pending), 302);
      },
    )
    .openapi(
      createRoute({
        method: "get",
        path: "/auth/callback",
        tags: ["auth"],
        summary: "Cognito から戻る口。code をトークンに替え、Cookie を発行して元の画面へ",
        request: {
          query: z.object({
            code: z.string().optional(),
            state: z.string().optional(),
            error: z.string().optional(),
          }),
        },
        responses: {
          302: { description: "成功なら元の画面へ。失敗なら /login?error=<code> へ" },
        },
      }),
      async (c) => {
        const q = c.req.valid("query");
        // 途中の状態は、成否にかかわらずここで消える(同じものを2回使わせない)
        const pending = await takePendingLogin(c, deps.session);
        const reject = (reason: string) => {
          deps.logger.warn({ reason }, "Cognito からの戻りを受け付けませんでした");
          return toLoginPage(c, "login_failed");
        };
        if (q.error) return reject("cognito_error");
        if (!pending) return reject("no_pending_login");
        if (!q.state || !sameSecret(q.state, pending.state)) return reject("state_mismatch");
        if (!q.code) return reject("no_code");
        try {
          const identity = await cognito.exchange(q.code, pending.codeVerifier, pending.nonce);
          await login(identity, c);
        } catch (e) {
          if (e instanceof CognitoRejected) return reject(e.reason);
          // DB の失敗も、ほかの API と同じ決まり(errors.ts)で「待てば通る / それ以外」に分ける
          const apiError = toApiError(e);
          if (apiError.code === "login_failed") return toLoginPage(c, apiError.code);
          if (apiError.code === "service_unavailable") {
            deps.logger.error({ err: e }, "Cognito か DB に届かず、ログインできませんでした");
            return toLoginPage(c, apiError.code);
          }
          deps.logger.error({ err: e }, "Cognito からの戻りの処理に失敗");
          return toLoginPage(c, "internal");
        }
        return c.redirect(pending.returnTo, 302);
      },
    );

  if (cognito.scanEnabled) {
    // ZAP の認証つきスキャン(stg だけ)。スキャン用のクライアント宛ての ID トークンで Cookie をもらう。
    // 画面のログインはこれを使わない(トークンをブラウザに渡さない)。config.ts が prod では許さない。
    router.openapi(
      createRoute({
        method: "post",
        path: "/auth/cognito",
        tags: ["auth"],
        summary: "【stg のスキャンだけ】スキャン用クライアントの ID トークンでログイン",
        request: { body: jsonBody(z.object({ idToken: z.string().min(1) })) },
        responses: { 200: LoggedIn, ...bodyErrors, 401: json(z.any(), "検証できない") },
      }),
      async (c) => {
        const identity = await cognito.verifyScanToken(c.req.valid("json").idToken);
        if (!identity) throw loginFailed();
        await login(identity, c);
        return c.json({ ok: true as const }, 200);
      },
    );
  }
  return router;
}

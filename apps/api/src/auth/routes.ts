import { AuthOptionsSchema, DevLoginSchema } from "@app/shared";
import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { MANUAL_AUDIT_ACTIONS, recordAudit } from "../audit/index.ts";
import { withTenant } from "../db/tenant.ts";
import { endSupportSession } from "../domains/organizations/index.ts";
import type { AppEnv } from "../env.ts";
import { bodyErrors, createRouter, json, jsonBody } from "../http/common.ts";
import { addCognitoRoutes } from "./cognito-routes.ts";
import { type LoginDeps, logIn } from "./login.ts";
import { CognitoClient, type CognitoSettings } from "./providers.ts";
import { clearSession } from "./session.ts";

// ログインとログアウトの入口。Cognito のときだけの入口(ログイン・登録・再設定)は cognito-routes.ts。

type Deps = LoginDeps & {
  auth: ({ mode: "dev" } | ({ mode: "cognito" } & CognitoSettings)) & {
    /** テスト用: 偽物の Cognito につないだ物に差し替える */
    cognito?: CognitoClient;
  };
};

const LoggedIn = json(z.object({ ok: z.literal(true) }), "ログインした(Cookie を返す)");
const errorBody = (description: string) => json(z.any(), description);

const logoutRoute = createRoute({
  method: "post",
  path: "/auth/logout",
  tags: ["auth"],
  summary: "ログアウト",
  description: "Cookie を消す。そのあと GET /api/auth/options の logoutUrl(ログイン画面)へ移る",
  responses: { 204: { description: "Cookie を消した" } },
});

const optionsRoute = createRoute({
  method: "get",
  path: "/auth/options",
  tags: ["auth"],
  summary: "ログインの方式(画面がログインとログアウトの出し方を決める)",
  responses: { 200: json(AuthOptionsSchema, "方式") },
});

const devLoginRoute = createRoute({
  method: "post",
  path: "/auth/dev-login",
  tags: ["auth"],
  summary: "【開発環境だけ】メールアドレスだけでログイン",
  request: { body: jsonBody(DevLoginSchema) },
  responses: { 200: LoggedIn, ...bodyErrors, 401: errorBody("いない") },
});

export function authRoutes(deps: Deps) {
  const cognito =
    deps.auth.mode === "cognito" ? (deps.auth.cognito ?? new CognitoClient(deps.auth)) : null;

  const router = createRouter()
    .openapi(logoutRoute, async (c) => {
      await logOut(deps, c);
      return c.body(null, 204);
    })
    .openapi(optionsRoute, (c) =>
      c.json(
        cognito
          ? { method: "cognito" as const, logoutUrl: cognito.logoutUrl }
          : { method: "dev" as const },
        200,
      ),
    );

  if (!cognito) {
    // 開発用ログイン。config.ts が local / test / preview 以外では起動させない。
    router.openapi(devLoginRoute, async (c) => {
      await logIn(deps, { kind: "email", email: c.req.valid("json").email }, c);
      return c.json({ ok: true as const }, 200);
    });
    return router;
  }

  addCognitoRoutes(router, deps, cognito);
  return router;
}

/** Cookie を消す。代理の最中なら、代理も終える(見ていた組織の記録に「出た」を残す) */
async function logOut(deps: LoginDeps, c: Context<AppEnv>) {
  const session = c.get("session");
  clearSession(c, deps.session);
  // ログアウトは必ず成功させる(記録に失敗しても Cookie は消してある)
  if (!session) return;
  const support = session.support;
  await withTenant(deps.db, session.tenantId, async (tx) => {
    if (support) await endSupportSession(tx, session.tenantId, support.sessionId);
    await recordAudit(tx, {
      tenantId: session.tenantId,
      actor: { kind: support ? "support" : "user", id: session.userId },
      action: support ? "support.end" : MANUAL_AUDIT_ACTIONS.logout,
      outcome: "allowed",
    });
  }).catch((err) => deps.logger.warn({ err }, "ログアウトの監査ログを残せませんでした"));
}

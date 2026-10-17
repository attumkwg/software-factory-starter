import { DevLoginSchema } from "@app/shared";
import { createRoute, z } from "@hono/zod-openapi";
import type { RootDb } from "../db/client.ts";
import { ApiError } from "../errors.ts";
import type { Logger } from "../logger.ts";
import { badRequestError, createRouter, json } from "../routes/common.ts";
import { findLogin } from "./lookup.ts";
import { type CognitoSettings, CognitoVerifier, type LoginIdentity } from "./providers.ts";
import { clearSession, type SessionConfig, writeSession } from "./session.ts";

type Deps = {
  db: RootDb;
  logger: Logger;
  session: SessionConfig;
  auth: ({ mode: "dev" } | ({ mode: "cognito" } & CognitoSettings)) & {
    cognitoVerifier?: CognitoVerifier;
  };
};

const LoggedIn = json(z.object({ ok: z.literal(true) }), "ログインした(Cookie を返す)");
const loginFailed = () => new ApiError(401, "login_failed", "ログインできませんでした");

export function authRoutes(deps: Deps) {
  async function login(identity: LoginIdentity, c: Parameters<typeof writeSession>[0]) {
    const session = await findLogin(deps.db, identity);
    if (!session) {
      deps.logger.warn({ kind: identity.kind }, "ログインに失敗");
      throw loginFailed();
    }
    await writeSession(c, deps.session, session);
    deps.logger.info({ userId: session.userId, loginTenantId: session.tenantId }, "ログイン");
  }

  const router = createRouter().openapi(
    createRoute({
      method: "post",
      path: "/auth/logout",
      tags: ["auth"],
      summary: "ログアウト",
      responses: { 204: { description: "Cookie を消した" } },
    }),
    (c) => {
      clearSession(c, deps.session);
      return c.body(null, 204);
    },
  );

  if (deps.auth.mode === "dev") {
    // 開発用ログイン。config.ts が local / test / preview 以外では起動させない。
    router.openapi(
      createRoute({
        method: "post",
        path: "/auth/dev-login",
        tags: ["auth"],
        summary: "【開発環境だけ】メールアドレスだけでログイン",
        request: { body: { content: { "application/json": { schema: DevLoginSchema } } } },
        responses: { 200: LoggedIn, ...badRequestError, 401: json(z.any(), "いない") },
      }),
      async (c) => {
        await login({ kind: "email", email: c.req.valid("json").email }, c);
        return c.json({ ok: true as const }, 200);
      },
    );
  } else {
    const verifier = deps.auth.cognitoVerifier ?? new CognitoVerifier(deps.auth);
    router.openapi(
      createRoute({
        method: "post",
        path: "/auth/cognito",
        tags: ["auth"],
        summary: "Cognito の ID トークンでログイン",
        request: {
          body: {
            content: { "application/json": { schema: z.object({ idToken: z.string().min(1) }) } },
          },
        },
        responses: { 200: LoggedIn, ...badRequestError, 401: json(z.any(), "検証できない") },
      }),
      async (c) => {
        const identity = await verifier.verify(c.req.valid("json").idToken);
        if (!identity) throw loginFailed();
        await login(identity, c);
        return c.json({ ok: true as const }, 200);
      },
    );
  }
  return router;
}

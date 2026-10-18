import { OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { authenticate } from "./auth/middleware.ts";
import type { CognitoVerifier } from "./auth/providers.ts";
import { authRoutes } from "./auth/routes.ts";
import { authorize } from "./authz/middleware.ts";
import type { Config } from "./config.ts";
import type { RootDb } from "./db/client.ts";
import type { AppEnv } from "./env.ts";
import { ApiError } from "./errors.ts";
import { healthRoutes, type Lifecycle } from "./health.ts";
import type { Logger } from "./logger.ts";
import { contextFromHeaders, getRequestContext, runWithRequestContext } from "./request-context.ts";
import { meRoutes } from "./routes/me.ts";
import { projectRoutes } from "./routes/projects.ts";
import { taskRoutes } from "./routes/tasks.ts";

export type AppDeps = {
  config: Config;
  db: RootDb;
  logger: Logger;
  lifecycle?: Lifecycle;
  /** テスト用: Cognito の公開鍵を差し替える */
  cognitoVerifier?: CognitoVerifier;
};

/** 1リクエストの文脈(request ID・trace ID)を作り、終わったらアクセスログを1行。 */
function requestContext(logger: Logger): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const ctx = contextFromHeaders((name) => c.req.header(name));
    const started = performance.now();
    await runWithRequestContext(ctx, async () => {
      c.header("x-request-id", ctx.requestId);
      await next();
      const isHealth = c.req.path === "/healthz" || c.req.path === "/readyz";
      logger[isHealth ? "debug" : "info"](
        {
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
          durationMs: Math.round(performance.now() - started),
        },
        "request",
      );
    });
  };
}

export function createApp(deps: AppDeps) {
  const { config, db, logger } = deps;
  const lifecycle = deps.lifecycle ?? { shuttingDown: false };
  const app = new OpenAPIHono<AppEnv>();

  app.use("*", requestContext(logger));
  app.use("*", secureHeaders());
  app.route("/", healthRoutes({ db, lifecycle }));

  // ここから下の /api/* は、全部「セッションを読む → 認可の関所」を通る
  app.use("/api/*", csrf());
  app.use("/api/*", authenticate(config.session));
  app.use("/api/*", authorize({ db, logger }));

  app.route(
    "/api",
    authRoutes({
      db,
      logger,
      session: config.session,
      auth: { ...config.auth, cognitoVerifier: deps.cognitoVerifier },
    }),
  );
  app.route("/api", meRoutes);
  app.route("/api", projectRoutes);
  app.route("/api", taskRoutes);

  if (config.exposeOpenApi) {
    app.doc31("/api/openapi.json", {
      openapi: "3.1.0",
      info: { title: "software-factory-starter API", version: "0.1.0" },
    });
  }

  // 画面は配らない。画面は別のサービス(apps/web の SSR)で、ALB が /api/* だけをここへ振り分ける。

  app.notFound((c) =>
    c.json(
      {
        error: {
          code: "not_found",
          message: "見つかりません",
          requestId: getRequestContext()?.requestId,
        },
      },
      404,
    ),
  );

  app.onError((err, c) => {
    const requestId = getRequestContext()?.requestId;
    if (err instanceof ApiError) {
      return c.json({ error: { code: err.code, message: err.message, requestId } }, err.status);
    }
    if (err instanceof HTTPException) {
      return c.json(
        {
          error: {
            code: "http_error",
            message: err.message || "このリクエストは受け付けられません",
            requestId,
          },
        },
        err.status,
      );
    }
    logger.error({ err }, "unhandled error");
    return c.json({ error: { code: "internal", message: "内部エラーです", requestId } }, 500);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;

import { OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { csrf } from "hono/csrf";
import { secureHeaders } from "hono/secure-headers";
import { authenticate } from "./auth/middleware.ts";
import type { CognitoVerifier } from "./auth/providers.ts";
import { authRoutes } from "./auth/routes.ts";
import { authorize } from "./authz/middleware.ts";
import type { Config } from "./config.ts";
import type { RootDb } from "./db/client.ts";
import type { AppEnv } from "./env.ts";
import { payloadTooLarge, toApiError } from "./errors.ts";
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
  app.route("/", healthRoutes({ db, lifecycle, logger }));

  // ここから下の /api/* は、全部「本文の大きさ → セッションを読む → 認可の関所」を通る
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: () => {
        throw payloadTooLarge();
      },
    }),
  );
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

  // 失敗はすべてここで同じ形にする(errors.ts)。中身(SQL・値・スタック)は返さない。
  //   4xx … 利用者の側の問題。ログは残さない(アクセスログに status が出る)
  //   409 … 同時の変更。多いと設計の問題なので warn で数える
  //   5xx … こちらの問題。error で残す(503 は待てば通るので Retry-After を付ける)
  app.onError((err, c) => {
    const requestId = getRequestContext()?.requestId;
    const apiError = toApiError(err);
    if (apiError.status >= 500) logger.error({ err, code: apiError.code }, "失敗しました");
    else if (apiError.code === "conflict") logger.warn({ err }, "同時の変更とぶつかりました");
    if (apiError.code === "service_unavailable") c.header("retry-after", "5");
    return c.json(
      { error: { code: apiError.code, message: apiError.message, requestId } },
      apiError.status,
    );
  });

  return app;
}

export type App = ReturnType<typeof createApp>;

import { randomUUID } from "node:crypto";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { Logger } from "pino";

// 画面のサービス(SSR)の入口。ALB から「/api/* 以外」が全部ここに来る。
//
//   /assets/*        … ビルド済みの JS・CSS(名前にハッシュが入るので1年キャッシュ)
//   /healthz /readyz … ECS と ALB の生存確認(API と同じ決まり)
//   それ以外の GET   … TanStack Start が HTML を描いて返す(loader が API を読む)
//
// 書き込み(POST など)は受けない。書き込みはブラウザから API へ直接(CSRF の守りを1か所に)。
// サーバー関数(createServerFn)を使うようにしたら、ここで POST を通すように緩める。

export type SsrHandler = (request: Request) => Promise<Response> | Response;
export type Lifecycle = { shuttingDown: boolean };

// API(apps/api/src/request-context.ts)と同じ形。上から来た ID は形が正しいときだけ引き継ぐ
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
const requestIdFrom = (incoming: string | undefined) =>
  incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();

export function createWebApp(deps: {
  ssr: SsrHandler;
  clientDir: string;
  logger: Logger;
  lifecycle: Lifecycle;
}) {
  const { ssr, clientDir, logger, lifecycle } = deps;
  const app = new Hono<{ Variables: { requestId: string } }>();

  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/readyz", (c) =>
    lifecycle.shuttingDown ? c.json({ ok: false }, 503) : c.json({ ok: true }),
  );

  // 1リクエストに1つの request ID(ALB や上流から来たものを引き継ぐ)。SSR から API へも渡る
  app.use("*", async (c, next) => {
    const requestId = requestIdFrom(c.req.header("x-request-id"));
    c.set("requestId", requestId);
    const started = performance.now();
    await next();
    c.header("x-request-id", requestId);
    logger.info(
      {
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - started),
      },
      "request",
    );
  });
  app.use("*", secureHeaders());

  app.use(
    "/assets/*",
    async (c, next) => {
      await next();
      if (c.res.ok) c.header("cache-control", "public, max-age=31536000, immutable");
    },
    serveStatic({ root: clientDir }),
  );

  app.on(["GET", "HEAD"], "*", async (c) => {
    const headers = new Headers(c.req.raw.headers);
    headers.set("x-request-id", c.get("requestId"));
    try {
      return await ssr(new Request(c.req.raw.url, { method: c.req.method, headers }));
    } catch (err) {
      logger.error({ err }, "SSR で失敗");
      return c.text("内部エラーです", 500);
    }
  });

  app.all("*", (c) => c.text("Method Not Allowed", 405, { allow: "GET, HEAD" }));

  return app;
}

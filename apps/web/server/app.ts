import { randomUUID } from "node:crypto";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { Logger } from "pino";
import { compressResponse } from "./compress.ts";

// 画面のサービス(SSR)の入口。ALB から「/api/* 以外」が全部ここに来る。
//
//   /assets/*        … ビルド済みの JS・CSS(名前にハッシュが入るので1年キャッシュ)。
//                      ビルドのときに圧縮しておいた .br / .gz を、ブラウザが受け取れる方で返す
//                      (ALB は圧縮しない。scripts/precompress.mjs)
//   /healthz /readyz … ECS と ALB の生存確認(API と同じ決まり)
//   それ以外の GET   … TanStack Start が HTML を描いて返す(loader が API を読む)。
//                      その場で圧縮し、描けた所から順に流す(server/compress.ts)
//
// 書き込み(POST など)は受けない。書き込みはブラウザから API へ直接(CSRF の守りを1か所に)。
// サーバー関数(createServerFn)を使うようにしたら、ここで POST を通すように緩める。

export type SsrHandler = (request: Request) => Promise<Response> | Response;
export type Lifecycle = { shuttingDown: boolean };

// API(apps/api/src/request-context.ts)と同じ形。上から来た ID は形が正しいときだけ引き継ぐ
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
// 守りのヘッダー(API と同じ secureHeaders に、画面の分を足す)
//   HSTS          … 1年(既定の180日から延ばす)。一度 https で来たブラウザは、1年は http で来ない
//   Permissions-Policy … 画面で使わない機能(カメラ・マイク・位置など)を、埋め込まれた物も含めて止める。
//                    使うようにしたら、ここで外す
const SECURE_HEADERS = secureHeaders({
  strictTransportSecurity: "max-age=31536000; includeSubDomains",
  permissionsPolicy: {
    camera: [],
    microphone: [],
    geolocation: [],
    payment: [],
    usb: [],
    serial: [],
    bluetooth: [],
    hid: [],
    midi: [],
    accelerometer: [],
    gyroscope: [],
    magnetometer: [],
    displayCapture: [],
    browsingTopics: [],
  },
});

const requestIdFrom = (incoming: string | undefined) =>
  incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();

// Response.redirect() などはヘッダーを書き換えられないので、写して作り直す
function withNoStore(res: Response): Response {
  if (res.headers.has("cache-control")) return res;
  const headers = new Headers(res.headers);
  headers.set("cache-control", "no-store");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

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
  app.use("*", SECURE_HEADERS);

  app.use(
    "/assets/*",
    async (c, next) => {
      await next();
      if (c.res.ok) c.header("cache-control", "public, max-age=31536000, immutable");
    },
    serveStatic({ root: clientDir, precompressed: true }),
  );

  app.on(["GET", "HEAD"], "*", async (c) => {
    const headers = new Headers(c.req.raw.headers);
    headers.set("x-request-id", c.get("requestId"));
    try {
      const res = await ssr(new Request(c.req.raw.url, { method: c.req.method, headers }));
      // HTML はブラウザにも途中の仕組みにも残させない(ログインした人のプロジェクトやタスクが入る。
      // 共有の PC で「戻る」やキャッシュから見えないように)。ログイン前の画面も同じにする
      // (残しても速さの得は小さく、ログインの前後をここで見分けるより取り違えが無い)。
      // 画面の側で決めて付けたものはそのまま
      return compressResponse(c.req.raw, withNoStore(res));
    } catch (err) {
      logger.error({ err }, "SSR で失敗");
      return c.text("内部エラーです", 500);
    }
  });

  app.all("*", (c) => c.text("Method Not Allowed", 405, { allow: "GET, HEAD" }));

  return app;
}

import { randomUUID } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
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
//   /robots.txt      … 検索の決まり。本番以外は全部お断り(下の「検索に載せない」)
//   /favicon.svg など … public/ に置いた物(ビルドで dist/client の直下に並ぶ)。1日キャッシュ。
//                      拡張子のあるパスで、置いた物に無いものは SSR に回さずに 404(/favicon.ico・/wp-login.php など)
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

// 検索に載せない(X-Robots-Tag)。業務の画面なので、既定は全部の応答に付ける。
// 外してよいのは、本番(APP_ENV=prod)で、ここに書いたパスのページだけ(例: "/login"・"/sign-up")。
// プレビュー(pr-N.preview.<domain>)・stg・手元は、URL が漏れても載らないように一覧に関わらず全部付ける。
// 何を載せるかは事業の判断(docs/designs/0008-web-noindex-mobile.md の U-1)
export const INDEXABLE_PATHS: readonly string[] = [];
const NOINDEX = "noindex, nofollow";
// 本番は、検索の仕組みが X-Robots-Tag を読めるように辿るのは許す(Disallow にすると noindex が読まれず、
// よそのリンクから URL だけが載ることがある)。API は画面ではないので辿らせない
const ROBOTS_PROD = "User-agent: *\nDisallow: /api/\n";
const ROBOTS_OTHERS = "User-agent: *\nDisallow: /\n";
// 拡張子のある最後の区切り(/favicon.ico など)。画面のパス(/projects/<UUID> など)には「.」を使わない
const HAS_EXTENSION = /\/[^/]*\.[^/]+$/;

// public/ から来た物の一覧(dist/client の直下のファイル。前もって圧縮した .br / .gz は除く)
function publicFilesIn(clientDir: string): Set<string> {
  const names = readdirSync(clientDir).filter(
    (name) => !/\.(br|gz)$/.test(name) && statSync(join(clientDir, name)).isFile(),
  );
  return new Set(names.map((name) => `/${name}`));
}

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
  /** APP_ENV(local / test / preview / stg / prod)。無ければ本番ではない扱い */
  appEnv?: string;
  indexablePaths?: readonly string[];
}) {
  const { ssr, clientDir, logger, lifecycle } = deps;
  const isProd = deps.appEnv === "prod";
  const indexable = new Set(isProd ? (deps.indexablePaths ?? INDEXABLE_PATHS) : []);
  const publicFiles = publicFilesIn(clientDir);
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
  app.use("*", async (c, next) => {
    await next();
    if (!indexable.has(c.req.path)) c.header("x-robots-tag", NOINDEX);
  });

  app.get("/robots.txt", (c) =>
    c.text(isProd ? ROBOTS_PROD : ROBOTS_OTHERS, 200, { "cache-control": "public, max-age=3600" }),
  );

  app.use(
    "/assets/*",
    async (c, next) => {
      await next();
      if (c.res.ok) c.header("cache-control", "public, max-age=31536000, immutable");
    },
    serveStatic({ root: clientDir, precompressed: true }),
  );

  const servePublic = serveStatic({ root: clientDir, precompressed: true });
  app.on(["GET", "HEAD"], "*", async (c, next) => {
    if (publicFiles.has(c.req.path)) {
      const res = await servePublic(c, next);
      if (res?.ok) res.headers.set("cache-control", "public, max-age=86400");
      return res;
    }
    if (HAS_EXTENSION.test(c.req.path)) return c.text("Not Found", 404);
    return next();
  });

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

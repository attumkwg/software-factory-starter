import { randomUUID } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { NONCE, secureHeaders } from "hono/secure-headers";
import type { Logger } from "pino";
import { API_STATUS_HEADER, withApiStatus } from "./api-status.ts";
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
// SSR に CSP の nonce を渡すヘッダー(src/router.tsx が読む)。ブラウザから来た同じ名前の値は捨てる
export const CSP_NONCE_HEADER = "x-csp-nonce";

/** Sentry の DSN(https://<key>@o1.ingest.sentry.io/<id>)から、ブラウザが送る先の origin。読めなければ undefined。 */
export function reportOriginOf(dsn: string | undefined): string | undefined {
  return originOf(dsn);
}

/** URL の origin だけ(道すじ・鍵は落とす)。http(s) でなければ・読めなければ undefined(CSP に変な値を入れない) */
export function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : undefined;
  } catch {
    return undefined;
  }
}

// 守りのヘッダー(API と同じ secureHeaders に、画面の分を足す)
//   HSTS          … 1年(既定の180日から延ばす)。一度 https で来たブラウザは、1年は http で来ない
//   Permissions-Policy … 画面で使わない機能(カメラ・マイク・位置など)を、埋め込まれた物も含めて止める。
//                    使うようにしたら、ここで外す
//   CSP           … 読み込むのは自分の origin の物と、1リクエストごとの nonce の付いた埋め込みだけ
//                    (SSR が埋め込むスクリプトには TanStack が nonce を付ける)。外のサイトに枠で埋め込ませない。
//                    部品(React Aria)が style 属性を描くので、属性の style だけは許す(<style> の要素は nonce が要る)。
//                    外へ送るのは失敗の知らせ(Sentry)と、写真・ファイルの置き場(S3)だけ。
//                    置き場へは署名つき URL で PUT し(connect-src)、写真を表示する(img-src)。docs/specs/0072-file-storage.md。
//                    外の物を読むようにしたら、ここに足す(設計書 0045)
function secureHeadersFor(reportOrigin: string | undefined, filesOrigin: string | undefined) {
  const files = filesOrigin ? [filesOrigin] : [];
  return secureHeaders({
    strictTransportSecurity: "max-age=31536000; includeSubDomains",
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", NONCE],
      styleSrc: ["'self'", NONCE],
      styleSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", "data:", ...files],
      fontSrc: ["'self'"],
      connectSrc: ["'self'", ...(reportOrigin ? [reportOrigin] : []), ...files],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
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
}

// 検索に載せない(X-Robots-Tag)。業務の画面なので、既定は全部の応答に付ける。
// 外してよいのは、本番(APP_ENV=prod)で、ここに書いたパスのページだけ(例: "/login"・"/sign-up")。
// プレビュー(pr-N.preview.<domain>)・stg・手元は、URL が漏れても載らないように一覧に関わらず全部付ける。
// 何を載せるかは事業の判断(docs/designs/0015-web-noindex-mobile.md の U-1)
export const INDEXABLE_PATHS: readonly string[] = [];
const NOINDEX = "noindex, nofollow";
// 本番は、検索の仕組みが X-Robots-Tag を読めるように辿るのは許す(Disallow にすると noindex が読まれず、
// よそのリンクから URL だけが載ることがある)。API は画面ではないので辿らせない
const ROBOTS_PROD = "User-agent: *\nDisallow: /api/\n";
const ROBOTS_OTHERS = "User-agent: *\nDisallow: /\n";
// 最後の区切りに拡張子がある(/favicon.ico など)。画面のパス(/projects/<UUID> など)には「.」を使わない。
// 利用者が送る値なので、正規表現を使わずに見る(Semgrep の regex_dos に当たらないように)
const hasExtension = (path: string) => path.slice(path.lastIndexOf("/") + 1).includes(".");

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
  /** SENTRY_DSN(ブラウザから失敗を送る先。CSP の connect-src に足す)。無ければ自分の origin だけ */
  sentryDsn?: string;
  /**
   * FILES_ORIGIN(写真・ファイルの置き場の origin。CSP の connect-src・img-src に足す。docs/specs/0072-file-storage.md)。
   * 本番・stg は S3 の置き場の地域の入口(Terraform の module.files.origin)・手元は RustFS(http://localhost:9000)
   */
  filesOrigin?: string;
}) {
  const { ssr, clientDir, logger, lifecycle } = deps;
  const isProd = deps.appEnv === "prod";
  const indexable = new Set(isProd ? (deps.indexablePaths ?? INDEXABLE_PATHS) : []);
  const publicFiles = publicFilesIn(clientDir);
  const app = new Hono<{ Variables: { requestId: string; secureHeadersNonce?: string } }>();

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
  app.use("*", secureHeadersFor(reportOriginOf(deps.sentryDsn), originOf(deps.filesOrigin)));
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
    if (hasExtension(c.req.path)) return c.text("Not Found", 404);
    return next();
  });

  app.on(["GET", "HEAD"], "*", async (c) => {
    const headers = new Headers(c.req.raw.headers);
    headers.set("x-request-id", c.get("requestId"));
    headers.delete(CSP_NONCE_HEADER);
    // 受け皿の番号を渡す内側のヘッダーは、外から来た物を捨てる(SSR の応答からだけ読む。#186)
    headers.delete(API_STATUS_HEADER);
    const nonce = c.get("secureHeadersNonce");
    if (nonce) headers.set(CSP_NONCE_HEADER, nonce);
    try {
      const res = await ssr(new Request(c.req.raw.url, { method: c.req.method, headers }));
      // HTML はブラウザにも途中の仕組みにも残させない(ログインした人のプロジェクトやタスクが入る。
      // 共有の PC で「戻る」やキャッシュから見えないように)。ログイン前の画面も同じにする
      // (残しても速さの得は小さく、ログインの前後をここで見分けるより取り違えが無い)。
      // 画面の側で決めて付けたものはそのまま
      // API が断っただけ(権限が無い・無い物)なら 500 でなくその番号で返す(#186。api-status.ts)。
      // 書き換えたら1行残す(Logs Insights で「500 だった物」を後から数えられるように)
      const fixed = withApiStatus(res);
      if (fixed.rewrittenFrom !== undefined)
        logger.info(
          { requestId: c.get("requestId"), from: fixed.rewrittenFrom, to: fixed.res.status },
          "API の断りの番号で返した",
        );
      return compressResponse(c.req.raw, withNoStore(fixed.res));
    } catch (err) {
      logger.error({ err }, "SSR で失敗");
      return c.text("内部エラーです", 500);
    }
  });

  app.all("*", (c) => c.text("Method Not Allowed", 405, { allow: "GET, HEAD" }));

  return app;
}

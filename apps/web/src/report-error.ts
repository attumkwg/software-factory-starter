import { scrubMessage } from "@app/error-reporting/scrub";
import type { ErrorEvent } from "@sentry/browser";
import { createIsomorphicFn } from "@tanstack/react-start";
import { HttpError, NetworkError } from "./api.ts";

// ブラウザで起きた失敗を Sentry に送る(docs/guides/monitoring.md)。
//
// - 送り先(DSN)は画面のサーバーの環境変数から、<html data-sentry-dsn> に入れて渡す
//   (イメージは stg と prod で同じなので、ビルドのときには決められない。DSN は秘密ではない)
// - DSN が無ければ Sentry の JS を読み込みもしない(手元・テスト・プレビュー)
// - 送るのは「捕まえられなかった失敗」と「画面の受け皿に落ちたバグ」だけ。
//   API の失敗(HttpError)・通信の失敗(NetworkError)・SSR で起きた失敗(サーバーが送った)は送らない
// - 自動で集める物(パンくず・URL の ? 以降・利用者・ヘッダー)は全部切り、失敗の文から値を伏せる

export type ReportingConfig = { dsn?: string; environment?: string; release?: string };

/** サーバーでは環境変数から、ブラウザでは <html> の data 属性から読む(どちらも同じ値になる)。 */
export const reportingConfig = createIsomorphicFn()
  .server(
    (): ReportingConfig => ({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.APP_ENV,
      release: process.env.SENTRY_RELEASE,
    }),
  )
  .client((): ReportingConfig => {
    const d = document.documentElement.dataset;
    return { dsn: d.sentryDsn, environment: d.env, release: d.release };
  });

/** SSR で起きて、サーバーが Sentry に送った失敗(start.ts がブラウザ側でこの形に戻す)。 */
export class ServerReportedError extends Error {
  constructor() {
    super("想定外の失敗");
    this.name = "ServerReportedError";
  }
}

type SentryBrowser = typeof import("./sentry-browser.ts");
let loading: Promise<SentryBrowser> | null = null;

/** ブラウザで1回だけ呼ぶ(__root.tsx)。DSN が無ければ何もしない。 */
export function startBrowserReporting() {
  if (loading) return;
  const { dsn, environment, release } = reportingConfig();
  if (!dsn) return;
  loading = import("./sentry-browser.ts").then((Sentry) => {
    Sentry.init({
      dsn,
      environment,
      release,
      defaultIntegrations: false,
      integrations: [
        Sentry.globalHandlersIntegration(),
        Sentry.linkedErrorsIntegration(),
        Sentry.dedupeIntegration(),
      ],
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
        stackFrameVariables: false,
        frameContextLines: 0,
      },
      // 拡張機能・ほかのサイトのスクリプトの失敗は送らない
      allowUrls: [window.location.origin],
      initialScope: { tags: { service: "browser" } },
      beforeSend: scrubEvent,
    });
    return Sentry;
  });
}

/** 画面の受け皿(ErrorPage)に落ちた失敗を送る。こちらのバグだけ。 */
export function reportBrowserError(error: unknown) {
  if (!shouldReport(error)) return;
  void loading?.then((Sentry) => Sentry.captureException(error));
}

export function shouldReport(error: unknown): boolean {
  return !(
    error instanceof HttpError ||
    error instanceof NetworkError ||
    error instanceof ServerReportedError
  );
}

/** 送る直前に、値になりうる物を落とす。 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  for (const value of event.exception?.values ?? []) {
    if (value.value) value.value = scrubMessage(value.value);
  }
  if (event.message) event.message = scrubMessage(event.message);
  if (event.request?.url) event.request = { url: event.request.url.split(/[?#]/)[0] };
  else delete event.request;
  delete event.user;
  delete event.breadcrumbs;
  delete event.extra;
  return event;
}

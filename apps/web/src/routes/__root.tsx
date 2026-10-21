import { LinkRouterProvider, ToastProvider } from "@app/ui";
import uiCss from "@app/ui/styles.css?url";
import { createRootRoute, HeadContent, Outlet, Scripts, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { reportingConfig, startBrowserReporting } from "../report-error.ts";

// すべての画面の外枠(<html> から)。SSR で HTML を作り、ブラウザで同じものに命を吹き込む(hydration)。
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Tasks" },
    ],
    links: [
      { rel: "stylesheet", href: uiCss },
      // public/favicon.svg(画面のサーバーがそのまま返す。server/app.ts)
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    ],
  }),
  component: RootDocument,
});

function RootDocument() {
  const router = useRouter();
  // 失敗を Sentry に送る設定(DSN が無ければ何もしない)。サーバーで描いた値をブラウザが読む
  const reporting = reportingConfig();
  useEffect(() => startBrowserReporting(), []);
  return (
    <html
      lang="ja"
      data-sentry-dsn={reporting.dsn}
      data-env={reporting.environment}
      data-release={reporting.release}
    >
      <head>
        <HeadContent />
      </head>
      <body>
        {/* @app/ui の Link をこのルーターで動かす(ページを丸ごと読み直さない移動) */}
        <LinkRouterProvider navigate={(href) => router.navigate({ href })} useHref={(href) => href}>
          <ToastProvider>
            <Outlet />
          </ToastProvider>
        </LinkRouterProvider>
        <Scripts />
      </body>
    </html>
  );
}

import { LinkRouterProvider, ToastProvider } from "@app/ui";
import uiCss from "@app/ui/styles.css?url";
import { createRootRoute, HeadContent, Outlet, Scripts, useRouter } from "@tanstack/react-router";

// すべての画面の外枠(<html> から)。SSR で HTML を作り、ブラウザで同じものに命を吹き込む(hydration)。
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Tasks" },
    ],
    links: [{ rel: "stylesheet", href: uiCss }],
  }),
  component: RootDocument,
});

function RootDocument() {
  const router = useRouter();
  return (
    <html lang="ja">
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

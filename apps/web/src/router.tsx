import { createRouter } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { ErrorPage, NotFoundPage } from "./pages/ErrorPages.tsx";
import { routeTree } from "./routeTree.gen.ts";

// CSP の nonce。画面のサーバー(server/app.ts)が1リクエストごとに作り、x-csp-nonce で SSR に渡す。
// SSR では、埋め込むスクリプトに TanStack が付け、<meta property="csp-nonce"> にも書く。
// ブラウザでは、その meta から読む(後から足す head の要素にも同じ nonce を付けるため)。
// 手元の開発(pnpm dev)は画面のサーバーを通らないので、nonce も CSP も無い
const cspNonce = createIsomorphicFn()
  .server((): string | undefined => {
    try {
      return getRequest().headers.get("x-csp-nonce") ?? undefined;
    } catch {
      return undefined; // リクエストの外(ビルドなど)
    }
  })
  .client(
    (): string | undefined =>
      document.querySelector('meta[property="csp-nonce"]')?.getAttribute("content") ?? undefined,
  );

export function getRouter() {
  const nonce = cspNonce();
  return createRouter({
    routeTree,
    ...(nonce ? { ssr: { nonce } } : {}),
    scrollRestoration: true,
    // リンクにマウスが乗ったら、次の画面のデータを先に読む
    defaultPreload: "intent",
    // どの画面で失敗しても、同じ受け皿に(画面ごとに errorComponent を書かなくてよい)
    defaultErrorComponent: ErrorPage,
    defaultNotFoundComponent: NotFoundPage,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}

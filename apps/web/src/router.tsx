import { createRouter } from "@tanstack/react-router";
import { ErrorPage, NotFoundPage } from "./pages/ErrorPages.tsx";
import { routeTree } from "./routeTree.gen.ts";

export function getRouter() {
  return createRouter({
    routeTree,
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

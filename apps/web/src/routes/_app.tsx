import type { Me } from "@app/shared";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { api, HttpError } from "../api.ts";
import { AppHeader } from "../pages/AppHeader.tsx";

// ログインが要る画面をまとめる枠(URL には出ない)。ここで「誰か」を確かめ、子の画面に渡す。
// 守りは API 側(画面で隠すだけで安心しない)。ここは「ログイン画面へ回す」ための確認。
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ location }) => {
    let me: Me;
    try {
      me = await api.me();
    } catch (e) {
      // ログインの後に、開こうとしていた画面へ戻れるように(戻り先はアプリの中のパスだけ。safeReturnTo)
      if (e instanceof HttpError && e.status === 401)
        throw redirect({ to: "/login", search: { returnTo: location.href } });
      throw e;
    }
    // 組織が二段階認証を必須にしていて、まだ設定していない → 設定の画面へ(ほかの API も 403。守りは API 側)
    if (me.mfa?.setupRequired && location.pathname !== "/account") {
      throw redirect({ to: "/account" });
    }
    return { me };
  },
  component: AppLayout,
});

function AppLayout() {
  const { me } = Route.useRouteContext();
  return (
    <AppHeader me={me}>
      <Outlet />
    </AppHeader>
  );
}

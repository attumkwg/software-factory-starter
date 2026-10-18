import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { api, HttpError } from "../api.ts";
import { AppHeader } from "../pages/AppHeader.tsx";

// ログインが要る画面をまとめる枠(URL には出ない)。ここで「誰か」を確かめ、子の画面に渡す。
// 守りは API 側(画面で隠すだけで安心しない)。ここは「ログイン画面へ回す」ための確認。
export const Route = createFileRoute("/_app")({
  beforeLoad: async () => {
    try {
      return { me: await api.me() };
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) throw redirect({ to: "/login" });
      throw e;
    }
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

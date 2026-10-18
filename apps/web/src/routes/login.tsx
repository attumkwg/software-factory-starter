import { safeReturnTo } from "@app/shared";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { api } from "../api.ts";
import { type LoginNotice, LoginPage } from "../pages/LoginPage.tsx";

type LoginSearch = { notice?: LoginNotice; returnTo?: string };
const NOTICES: readonly LoginNotice[] = ["registered", "reset"];

export const Route = createFileRoute("/login")({
  // 知っている値だけを受け取る(URL の値をそのまま画面に出さない。文は messages.ts の固定の文)
  validateSearch: (search: Record<string, unknown>): LoginSearch => {
    const notice = NOTICES.find((n) => n === search.notice);
    const returnTo = safeReturnTo(search.returnTo);
    return { ...(notice ? { notice } : {}), ...(returnTo !== "/" ? { returnTo } : {}) };
  },
  // もうログインしていれば、戻り先(無ければ一覧)へ
  beforeLoad: async ({ search }) => {
    const me = await api.me().catch(() => null);
    if (me) throw redirect({ href: safeReturnTo(search.returnTo) });
  },
  loader: () => api.authOptions(),
  head: () => ({ meta: [{ title: "ログイン | Tasks" }] }),
  component: LoginRoute,
});

function LoginRoute() {
  const options = Route.useLoaderData();
  const { notice, returnTo } = Route.useSearch();
  return <LoginPage options={options} notice={notice} returnTo={safeReturnTo(returnTo)} />;
}

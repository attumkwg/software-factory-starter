import { safeReturnTo } from "@app/shared";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { api } from "../api.ts";
import { pageHead, SITE_NAME } from "../head.ts";
import { type LoginNotice, LoginPage, type SsoResult } from "../pages/LoginPage.tsx";

type LoginSearch = { notice?: LoginNotice; returnTo?: string; sso?: SsoResult };
const NOTICES: readonly LoginNotice[] = ["registered", "reset"];
// SSO の戻り(API が付ける ?sso=)と、関所の 403 sso_required(画面が付ける)。理由の詳しいことは言わない
const SSO_RESULTS: readonly SsoResult[] = ["failed", "ip_not_allowed", "required"];

export const Route = createFileRoute("/login")({
  // 知っている値だけを受け取る(URL の値をそのまま画面に出さない。文は messages.ts の固定の文)
  validateSearch: (search: Record<string, unknown>): LoginSearch => {
    const notice = NOTICES.find((n) => n === search.notice);
    const sso = SSO_RESULTS.find((n) => n === search.sso);
    const returnTo = safeReturnTo(search.returnTo);
    return {
      ...(notice ? { notice } : {}),
      ...(sso ? { sso } : {}),
      ...(returnTo !== "/" ? { returnTo } : {}),
    };
  },
  // もうログインしていれば、戻り先(無ければ一覧)へ
  beforeLoad: async ({ search }) => {
    const me = await api.me().catch(() => null);
    if (me) throw redirect({ href: safeReturnTo(search.returnTo) });
  },
  loader: () => api.authOptions(),
  head: () =>
    pageHead({
      title: "ログイン",
      description: `${SITE_NAME} にログインして、組織のプロジェクトとタスクを開きます。`,
      path: "/login",
    }),
  component: LoginRoute,
});

function LoginRoute() {
  const options = Route.useLoaderData();
  const { notice, returnTo, sso } = Route.useSearch();
  return (
    <LoginPage options={options} notice={notice} sso={sso} returnTo={safeReturnTo(returnTo)} />
  );
}

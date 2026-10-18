import { safeReturnTo } from "@app/shared";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { api } from "../api.ts";
import { LOGIN_PAGE_ERRORS, LoginPage, type LoginPageError } from "../pages/LoginPage.tsx";

type LoginSearch = { error?: LoginPageError; returnTo?: string };

export const Route = createFileRoute("/login")({
  // Cognito から戻ったときの失敗は、API が /login?error=<code> に返す(apps/api/src/auth/routes.ts)。
  // 知っている code だけを受け取り、文は messages.ts の固定の文を出す(URL の値をそのまま画面に出さない)。
  validateSearch: (search: Record<string, unknown>): LoginSearch => {
    const error = LOGIN_PAGE_ERRORS.find((e) => e === search.error);
    const returnTo = safeReturnTo(search.returnTo);
    return { ...(error ? { error } : {}), ...(returnTo !== "/" ? { returnTo } : {}) };
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
  const { error, returnTo } = Route.useSearch();
  return <LoginPage options={options} error={error} returnTo={safeReturnTo(returnTo)} />;
}

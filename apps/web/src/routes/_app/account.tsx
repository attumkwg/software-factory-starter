import { createFileRoute } from "@tanstack/react-router";
import { api } from "../../api.ts";
import { AccountPage } from "../../pages/AccountPage.tsx";

// 自分のアカウント(二段階認証・メール・パスワード。docs/specs/0006-account-security.md)。
// 本人のアカウントの API は Cognito のときだけあり、代理の社員は使えない(守りは API 側)。
export const Route = createFileRoute("/_app/account")({
  loader: async ({ context }) => {
    const options = await api.authOptions();
    if (options.method !== "cognito" || context.me.support) return { account: null };
    return { account: await api.getAccount() };
  },
  head: () => ({ meta: [{ title: "アカウント | Tasks" }] }),
  component: AccountRoute,
});

function AccountRoute() {
  const { me } = Route.useRouteContext();
  const { account } = Route.useLoaderData();
  return <AccountPage me={me} account={account} />;
}

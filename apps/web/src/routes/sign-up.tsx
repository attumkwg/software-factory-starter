import { safeReturnTo } from "@app/shared";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { api } from "../api.ts";
import { SignUpPage } from "../pages/SignUpPage.tsx";

export const Route = createFileRoute("/sign-up")({
  validateSearch: (search: Record<string, unknown>): { returnTo?: string } => {
    const returnTo = safeReturnTo(search.returnTo);
    return returnTo !== "/" ? { returnTo } : {};
  },
  // 登録は Cognito のときだけ(開発用ログインには無い)
  beforeLoad: async () => {
    const options = await api.authOptions();
    if (options.method !== "cognito") throw redirect({ to: "/login" });
  },
  head: () => ({ meta: [{ title: "登録 | Tasks" }] }),
  component: SignUpRoute,
});

function SignUpRoute() {
  const { returnTo } = Route.useSearch();
  return <SignUpPage returnTo={safeReturnTo(returnTo)} />;
}

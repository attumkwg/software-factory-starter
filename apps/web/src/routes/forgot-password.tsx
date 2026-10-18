import { createFileRoute, redirect } from "@tanstack/react-router";
import { api } from "../api.ts";
import { ForgotPasswordPage } from "../pages/ForgotPasswordPage.tsx";

export const Route = createFileRoute("/forgot-password")({
  // 再設定は Cognito のときだけ(開発用ログインにはパスワードが無い)
  beforeLoad: async () => {
    const options = await api.authOptions();
    if (options.method !== "cognito") throw redirect({ to: "/login" });
  },
  head: () => ({ meta: [{ title: "パスワードの再設定 | Tasks" }] }),
  component: ForgotPasswordPage,
});

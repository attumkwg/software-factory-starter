import { createFileRoute, redirect } from "@tanstack/react-router";
import { api } from "../api.ts";
import { pageHead, SITE_NAME } from "../head.ts";
import { ForgotPasswordPage } from "../pages/ForgotPasswordPage.tsx";

export const Route = createFileRoute("/forgot-password")({
  // 再設定は Cognito のときだけ(開発用ログインにはパスワードが無い)
  beforeLoad: async () => {
    const options = await api.authOptions();
    if (options.method !== "cognito") throw redirect({ to: "/login" });
  },
  head: () =>
    pageHead({
      title: "パスワードの再設定",
      description: `${SITE_NAME} のパスワードを、登録したメールアドレスに届く確認コードで設定し直します。`,
      path: "/forgot-password",
    }),
  component: ForgotPasswordPage,
});

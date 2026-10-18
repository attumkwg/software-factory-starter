import { createFileRoute, redirect } from "@tanstack/react-router";
import { api } from "../api.ts";
import { LoginPage } from "../pages/LoginPage.tsx";

export const Route = createFileRoute("/login")({
  // もうログインしていれば一覧へ
  beforeLoad: async () => {
    const me = await api.me().catch(() => null);
    if (me) throw redirect({ to: "/" });
  },
  head: () => ({ meta: [{ title: "ログイン | Tasks" }] }),
  component: LoginPage,
});

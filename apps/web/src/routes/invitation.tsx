import { createFileRoute } from "@tanstack/react-router";
import { api } from "../api.ts";
import { pageHead, SITE_NAME } from "../head.ts";
import { InvitationAcceptPage } from "../pages/InvitationAcceptPage.tsx";

// 招待を受ける(ログイン無しで開ける。docs/specs/0027-invitations.md)。
// リンクの札は URL の # の後ろ(サーバーには届かない・ログと Referer に残らない)。画面が送るときに読む
export const Route = createFileRoute("/invitation")({
  loader: () => api.authOptions(),
  head: () =>
    pageHead({
      title: "招待を受ける",
      description: `${SITE_NAME} の組織への招待を受けて、参加します。`,
      path: "/invitation",
    }),
  component: InvitationRoute,
});

function InvitationRoute() {
  const options = Route.useLoaderData();
  return <InvitationAcceptPage options={options} />;
}

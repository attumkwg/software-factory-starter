import { createFileRoute } from "@tanstack/react-router";
import { api } from "../../api.ts";
import { pageHead } from "../../head.ts";
import { MembersPage } from "../../pages/MembersPage.tsx";

// 組織の人と強制ログアウト(組織の管理者だけ。守りは API 側: 管理者以外は 403 → 画面の受け皿)
export const Route = createFileRoute("/_app/members")({
  loader: () => api.listMembers(),
  head: () => pageHead({ title: "組織の人" }),
  component: MembersRoute,
});

function MembersRoute() {
  const { me } = Route.useRouteContext();
  const { members } = Route.useLoaderData();
  return <MembersPage me={me} members={members} />;
}

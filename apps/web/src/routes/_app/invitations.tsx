import { createFileRoute } from "@tanstack/react-router";
import { api } from "../../api.ts";
import { pageHead } from "../../head.ts";
import { InvitationsPage } from "../../pages/InvitationsPage.tsx";

// 招待(組織の管理者だけ。守りは API 側: 管理者以外は 403 → 画面の受け皿)
export const Route = createFileRoute("/_app/invitations")({
  loader: async () => {
    const [list, plan] = await Promise.all([api.listInvitations(), api.getOrganizationPlan()]);
    return { ...list, plan };
  },
  head: () => pageHead({ title: "招待" }),
  component: InvitationsRoute,
});

function InvitationsRoute() {
  const { me } = Route.useRouteContext();
  const { invitations, plan } = Route.useLoaderData();
  return <InvitationsPage me={me} invitations={invitations} plan={plan} />;
}

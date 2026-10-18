import { createFileRoute } from "@tanstack/react-router";
import { api } from "../../api.ts";
import { SupportGrantsPage } from "../../pages/SupportGrantsPage.tsx";

// サポートへの許可(組織の管理者だけ。守りは API 側: 管理者以外は 403 → 画面の受け皿)
export const Route = createFileRoute("/_app/support-access")({
  loader: () => api.listSupportGrants(),
  head: () => ({ meta: [{ title: "サポートへの許可 | Tasks" }] }),
  component: SupportAccessRoute,
});

function SupportAccessRoute() {
  const { me } = Route.useRouteContext();
  const { grants } = Route.useLoaderData();
  return <SupportGrantsPage me={me} grants={grants} />;
}

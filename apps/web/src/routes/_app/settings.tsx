import { createFileRoute } from "@tanstack/react-router";
import { api } from "../../api.ts";
import { SettingsPage } from "../../pages/SettingsPage.tsx";

// 組織の管理者の設定(守りは API 側: 中の API は管理者以外 403)
export const Route = createFileRoute("/_app/settings")({
  loader: () => api.getMfaRequirement(),
  head: () => ({ meta: [{ title: "設定 | Tasks" }] }),
  component: SettingsRoute,
});

function SettingsRoute() {
  const { me } = Route.useRouteContext();
  const mfa = Route.useLoaderData();
  return <SettingsPage me={me} mfa={mfa} />;
}

import { hasFeature } from "@app/shared";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "../../api.ts";
import { pageHead } from "../../head.ts";
import { SettingsPage } from "../../pages/SettingsPage.tsx";

// 組織の管理者の設定(守りは API 側: 中の API は管理者以外 403)。
// 会社のドメインと IP の範囲は、プランの機能が入った組織のときだけ読む(docs/specs/0056-sso-scim-ip-audit-export.md)
export const Route = createFileRoute("/_app/settings")({
  loader: async ({ context }) => {
    const [mfa, domains, ipAllowlist] = await Promise.all([
      api.getMfaRequirement(),
      hasFeature(context.me, "sso") ? api.listDomains() : null,
      hasFeature(context.me, "ip-allowlist") ? api.getIpAllowlist() : null,
    ]);
    return { mfa, domains: domains?.domains ?? null, ipAllowlist };
  },
  head: () => pageHead({ title: "設定" }),
  component: SettingsRoute,
});

function SettingsRoute() {
  const { me } = Route.useRouteContext();
  const { mfa, domains, ipAllowlist } = Route.useLoaderData();
  return <SettingsPage me={me} mfa={mfa} domains={domains} ipAllowlist={ipAllowlist} />;
}

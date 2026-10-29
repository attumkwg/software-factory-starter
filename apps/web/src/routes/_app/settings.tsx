import { hasFeature } from "@app/shared";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "../../api.ts";
import { pageHead } from "../../head.ts";
import { SettingsPage } from "../../pages/SettingsPage.tsx";

// 組織の管理者の設定(守りは API 側: 中の API は管理者以外 403)。
// 会社のドメイン・SSO・IP の範囲・SCIM の鍵は、プランの機能が入った組織のときだけ読む(docs/specs/0056-sso-scim-ip-audit-export.md)
export const Route = createFileRoute("/_app/settings")({
  loader: async ({ context }) => {
    const sso = hasFeature(context.me, "sso");
    const [mfa, taskMail, domains, ipAllowlist, ssoSettings, members, scim] = await Promise.all([
      api.getMfaRequirement(),
      api.getTaskMail(),
      sso ? api.listDomains() : null,
      hasFeature(context.me, "ip-allowlist") ? api.getIpAllowlist() : null,
      sso ? api.getSso() : null,
      // SSO の緊急用に選べるのは管理者だけ
      sso ? api.listMembers() : null,
      hasFeature(context.me, "scim") ? api.listScimTokens() : null,
    ]);
    const admins = members?.members.filter((m) => m.role === "admin") ?? [];
    return {
      mfa,
      taskMail,
      domains: domains?.domains ?? null,
      ipAllowlist,
      sso: ssoSettings ? { state: ssoSettings, admins } : null,
      scim,
    };
  },
  head: () => pageHead({ title: "設定" }),
  component: SettingsRoute,
});

function SettingsRoute() {
  const { me } = Route.useRouteContext();
  const { mfa, taskMail, domains, ipAllowlist, sso, scim } = Route.useLoaderData();
  return (
    <SettingsPage
      me={me}
      mfa={mfa}
      taskMail={taskMail}
      domains={domains}
      ipAllowlist={ipAllowlist}
      sso={sso}
      scim={scim}
    />
  );
}

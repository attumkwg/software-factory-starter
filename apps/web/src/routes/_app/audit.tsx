import { createFileRoute } from "@tanstack/react-router";
import { api } from "../../api.ts";
import { pageHead } from "../../head.ts";
import { AuditPage } from "../../pages/AuditPage.tsx";

// 監査ログ(管理者だけ。守りは API 側: admin 以外は 403 → 画面の受け皿が「権限がありません」)
export const Route = createFileRoute("/_app/audit")({
  // 続きの印は URL に持つ(?before=…)。形は API が確かめる(変なら 400 → 受け皿)
  validateSearch: (search: Record<string, unknown>): { before?: string } =>
    typeof search.before === "string" && search.before.length <= 100
      ? { before: search.before }
      : {},
  loaderDeps: ({ search }) => ({ before: search.before }),
  loader: ({ deps }) => api.listAuditEvents(deps.before),
  head: () => pageHead({ title: "監査ログ" }),
  component: AuditRoute,
});

function AuditRoute() {
  const { me } = Route.useRouteContext();
  const page = Route.useLoaderData();
  return <AuditPage me={me} page={page} />;
}

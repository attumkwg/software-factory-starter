import { createFileRoute } from "@tanstack/react-router";
import { api } from "../../api.ts";
import { pageHead } from "../../head.ts";
import { OrganizationsPage } from "../../pages/OrganizationsPage.tsx";

// 所属している組織と、選び直し(docs/specs/0055-multi-org-membership.md)。守りは API 側(所属していない組織は 404)
export const Route = createFileRoute("/_app/organizations")({
  loader: () => api.listMyOrganizations(),
  head: () => pageHead({ title: "組織を切り替える" }),
  component: OrganizationsRoute,
});

function OrganizationsRoute() {
  const { organizations } = Route.useLoaderData();
  return <OrganizationsPage organizations={organizations} />;
}

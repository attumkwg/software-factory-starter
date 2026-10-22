import { createFileRoute } from "@tanstack/react-router";
import { api } from "../../api.ts";
import { pageHead } from "../../head.ts";
import { ProjectsPage } from "../../pages/ProjectsPage.tsx";

export const Route = createFileRoute("/_app/")({
  loader: () => api.listProjects(),
  head: () => pageHead({ title: "プロジェクト" }),
  component: ProjectsRoute,
});

function ProjectsRoute() {
  const { me } = Route.useRouteContext();
  const { projects } = Route.useLoaderData();
  return <ProjectsPage me={me} projects={projects} />;
}

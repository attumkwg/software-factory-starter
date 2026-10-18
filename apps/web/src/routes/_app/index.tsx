import { createFileRoute } from "@tanstack/react-router";
import { api } from "../../api.ts";
import { ProjectsPage } from "../../pages/ProjectsPage.tsx";

export const Route = createFileRoute("/_app/")({
  loader: () => api.listProjects(),
  head: () => ({ meta: [{ title: "プロジェクト | Tasks" }] }),
  component: ProjectsRoute,
});

function ProjectsRoute() {
  const { me } = Route.useRouteContext();
  const { projects } = Route.useLoaderData();
  return <ProjectsPage me={me} projects={projects} />;
}

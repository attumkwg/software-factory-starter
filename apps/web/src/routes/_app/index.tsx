import { hasFeature } from "@app/shared";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "../../api.ts";
import { pageHead } from "../../head.ts";
import { ProjectsPage } from "../../pages/ProjectsPage.tsx";

export const Route = createFileRoute("/_app/")({
  // 「無くなったら困るか」は、機能フラグを入れた組織のときだけ読む(docs/specs/0046-pmf-survey.md)
  loader: async ({ context }) => {
    const [{ projects }, survey] = await Promise.all([
      api.listProjects(),
      hasFeature(context.me, "pmf-survey") ? api.pmfSurveyStatus() : null,
    ]);
    return { projects, survey };
  },
  head: () => pageHead({ title: "プロジェクト" }),
  component: ProjectsRoute,
});

function ProjectsRoute() {
  const { me } = Route.useRouteContext();
  const { projects, survey } = Route.useLoaderData();
  return <ProjectsPage me={me} projects={projects} askSurvey={survey?.ask ?? false} />;
}

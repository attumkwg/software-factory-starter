import { createFileRoute, notFound } from "@tanstack/react-router";
import { api, HttpError } from "../../../api.ts";
import { pageHead } from "../../../head.ts";
import { type TaskFilter, TasksPage, toTaskFilter } from "../../../pages/TasksPage.tsx";

export const Route = createFileRoute("/_app/projects/$projectId")({
  // 絞り込みは URL に持つ(?filter=open)。共有・再読み込みしても同じ表示になる。「すべて」は URL に出さない
  validateSearch: (search: Record<string, unknown>): { filter?: Exclude<TaskFilter, "all"> } => {
    const filter = toTaskFilter(search.filter);
    return filter === "all" ? {} : { filter };
  },
  loader: async ({ params }) => {
    try {
      const [project, { tasks }] = await Promise.all([
        api.getProject(params.projectId),
        api.listTasks(params.projectId),
      ]);
      return { project, tasks };
    } catch (e) {
      // 無い・形が変な ID・他社のもの(API は 404 を返す)は「見つかりません」に
      if (e instanceof HttpError && (e.status === 404 || e.status === 400)) throw notFound();
      throw e;
    }
  },
  head: ({ loaderData }) => pageHead({ title: loaderData?.project.name ?? "プロジェクト" }),
  component: TasksRoute,
});

function TasksRoute() {
  const { me } = Route.useRouteContext();
  const { project, tasks } = Route.useLoaderData();
  const { filter = "all" } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <TasksPage
      me={me}
      project={project}
      tasks={tasks}
      filter={filter}
      onFilterChange={(next) =>
        navigate({ search: next === "all" ? {} : { filter: next }, replace: true })
      }
    />
  );
}

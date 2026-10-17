import { CreateTaskSchema, IdSchema, TaskSchema, UpdateTaskSchema } from "@app/shared";
import { createRoute, z } from "@hono/zod-openapi";
import { notFound } from "../errors.ts";
import { getProject } from "../repositories/projects.ts";
import { scopeOf } from "../repositories/scope.ts";
import { createTask, deleteTask, listTasks, updateTask } from "../repositories/tasks.ts";
import { authErrors, badRequestError, createRouter, json, notFoundError } from "./common.ts";

const ProjectParams = z.object({ projectId: IdSchema });
const TaskParams = z.object({ taskId: IdSchema });

export const taskRoutes = createRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/projects/{projectId}/tasks",
      tags: ["tasks"],
      summary: "プロジェクトのタスク一覧",
      request: { params: ProjectParams },
      responses: {
        200: json(z.object({ tasks: z.array(TaskSchema) }), "一覧"),
        ...badRequestError,
        ...authErrors,
        ...notFoundError,
      },
    }),
    async (c) => {
      const scope = scopeOf(c);
      const { projectId } = c.req.valid("param");
      if (!(await getProject(scope, projectId))) throw notFound();
      return c.json({ tasks: await listTasks(scope, projectId) }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/projects/{projectId}/tasks",
      tags: ["tasks"],
      summary: "タスクを足す",
      request: {
        params: ProjectParams,
        body: { content: { "application/json": { schema: CreateTaskSchema } } },
      },
      responses: {
        201: json(TaskSchema, "作った"),
        ...badRequestError,
        ...authErrors,
        ...notFoundError,
      },
    }),
    async (c) => {
      const scope = scopeOf(c);
      const { projectId } = c.req.valid("param");
      if (!(await getProject(scope, projectId))) throw notFound();
      return c.json(await createTask(scope, projectId, c.req.valid("json")), 201);
    },
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/tasks/{taskId}",
      tags: ["tasks"],
      summary: "タスクを直す(題名・完了)",
      request: {
        params: TaskParams,
        body: { content: { "application/json": { schema: UpdateTaskSchema } } },
      },
      responses: {
        200: json(TaskSchema, "直した"),
        ...badRequestError,
        ...authErrors,
        ...notFoundError,
      },
    }),
    async (c) => {
      const task = await updateTask(scopeOf(c), c.req.valid("param").taskId, c.req.valid("json"));
      if (!task) throw notFound();
      return c.json(task, 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/tasks/{taskId}",
      tags: ["tasks"],
      summary: "タスクを消す",
      request: { params: TaskParams },
      responses: {
        204: { description: "消した" },
        ...badRequestError,
        ...authErrors,
        ...notFoundError,
      },
    }),
    async (c) => {
      if (!(await deleteTask(scopeOf(c), c.req.valid("param").taskId))) throw notFound();
      return c.body(null, 204);
    },
  );

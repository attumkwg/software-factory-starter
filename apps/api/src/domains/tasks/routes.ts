import {
  CreateTaskSchema,
  IdSchema,
  TaskPageSchema,
  TaskSchema,
  UpdateTaskSchema,
} from "@app/shared";
import { createRoute, z } from "@hono/zod-openapi";
import { scopeOf } from "../../db/scope.ts";
import { notFound } from "../../errors.ts";
import {
  authErrors,
  badRequestError,
  bodyErrors,
  conflictError,
  createRouter,
  json,
  jsonBody,
  notFoundError,
  PageQuery,
} from "../../http/common.ts";
import { enqueue } from "../../outbox/index.ts";
// ほかの領域(projects)は index.ts の関数だけを使う。表を直接読まない
import { findTaskMailEnabled } from "../organizations/index.ts";
import { projectExists } from "../projects/index.ts";
import { createTask, deleteTask, listTasks, updateTask } from "./repository.ts";

const ProjectParams = z.object({ projectId: IdSchema });
const TaskParams = z.object({ taskId: IdSchema });

export const taskRoutes = createRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/projects/{projectId}/tasks",
      tags: ["tasks"],
      summary: "プロジェクトのタスク一覧(古い順。続きは nextCursor を cursor に)",
      request: { params: ProjectParams, query: PageQuery },
      responses: {
        200: json(TaskPageSchema, "一覧"),
        ...badRequestError,
        ...authErrors,
        ...notFoundError,
      },
    }),
    async (c) => {
      const scope = scopeOf(c);
      const { projectId } = c.req.valid("param");
      if (!(await projectExists(scope, projectId))) throw notFound();
      return c.json(await listTasks(scope, projectId, c.req.valid("query")), 200);
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
        body: jsonBody(CreateTaskSchema),
      },
      responses: {
        201: json(TaskSchema, "作った"),
        ...bodyErrors,
        ...authErrors,
        ...notFoundError,
        // 確かめた直後にプロジェクトが消された(外部キー)
        ...conflictError,
      },
    }),
    async (c) => {
      const scope = scopeOf(c);
      const { projectId } = c.req.valid("param");
      if (!(await projectExists(scope, projectId))) throw notFound();
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
        body: jsonBody(UpdateTaskSchema),
      },
      responses: {
        200: json(TaskSchema, "直した"),
        ...bodyErrors,
        ...authErrors,
        ...notFoundError,
      },
    }),
    async (c) => {
      const scope = scopeOf(c);
      const result = await updateTask(scope, c.req.valid("param").taskId, c.req.valid("json"));
      if (!result) throw notFound();
      // 完了になったことを、同じトランザクションで送信待ちに積む(アウトボックス。ADR 0006)
      if (result.completedNow) {
        await enqueue(scope, "tasks.task_completed", {
          taskId: result.task.id,
          projectId: result.task.projectId,
          completedBy: scope.userId,
          // 完了した時点で止めていたかを一緒に積む(送る前に戻されても、止めていた間の分は送らない)
          mailOffAtCompletion: !(await findTaskMailEnabled(scope.tx, scope.tenantId)),
        });
      }
      return c.json(result.task, 200);
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

import { CreateProjectSchema, IdSchema, ProjectPageSchema, ProjectSchema } from "@app/shared";
import { createRoute, z } from "@hono/zod-openapi";
import { scopeOf } from "../../db/scope.ts";
import { notFound } from "../../errors.ts";
import {
  authErrors,
  badRequestError,
  bodyErrors,
  createRouter,
  json,
  jsonBody,
  notFoundError,
  PageQuery,
} from "../../http/common.ts";
import { createProject, deleteProject, getProject, listProjects } from "./repository.ts";

// 権限はここに書かない(src/authz/policy.ts の ROUTE_RULES と docs/authz/matrix.yaml)。
const ProjectParams = z.object({ projectId: IdSchema });

export const projectRoutes = createRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/projects",
      tags: ["projects"],
      summary: "自分の組織のプロジェクト一覧(新しい順。続きは nextCursor を cursor に)",
      request: { query: PageQuery },
      responses: {
        200: json(ProjectPageSchema, "一覧"),
        ...badRequestError,
        ...authErrors,
      },
    }),
    async (c) => c.json(await listProjects(scopeOf(c), c.req.valid("query")), 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/projects",
      tags: ["projects"],
      summary: "プロジェクトを作る",
      request: { body: jsonBody(CreateProjectSchema) },
      responses: {
        201: json(ProjectSchema, "作った"),
        ...bodyErrors,
        ...authErrors,
      },
    }),
    async (c) => c.json(await createProject(scopeOf(c), c.req.valid("json")), 201),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/projects/{projectId}",
      tags: ["projects"],
      summary: "プロジェクトを1件",
      request: { params: ProjectParams },
      responses: {
        200: json(ProjectSchema, "見つかった"),
        ...badRequestError,
        ...authErrors,
        ...notFoundError,
      },
    }),
    async (c) => {
      const project = await getProject(scopeOf(c), c.req.valid("param").projectId);
      if (!project) throw notFound();
      return c.json(project, 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/projects/{projectId}",
      tags: ["projects"],
      summary: "プロジェクトを消す(中のタスクも消える)",
      request: { params: ProjectParams },
      responses: {
        204: { description: "消した" },
        ...badRequestError,
        ...authErrors,
        ...notFoundError,
      },
    }),
    async (c) => {
      const deleted = await deleteProject(scopeOf(c), c.req.valid("param").projectId);
      if (!deleted) throw notFound();
      return c.body(null, 204);
    },
  );

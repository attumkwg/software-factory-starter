import {
  CreatedFileSchema,
  CreateFileSchema,
  FilePageSchema,
  FileSchema,
  type FileView,
  IdSchema,
} from "@app/shared";
import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { canTouchFile } from "../../authz/policy.ts";
import { scopeOf, type TenantScope } from "../../db/scope.ts";
import type { AppEnv } from "../../env.ts";
import { ApiError, forbidden, notFound } from "../../errors.ts";
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
import type { ObjectStore } from "../../storage/index.ts";
import { taskExists } from "../tasks/index.ts";
import type { InTenantTx } from "./process.ts";
import {
  createFile,
  deleteFile,
  type FileRow,
  findFile,
  listFiles,
  requestProcessing,
  toFileView,
} from "./repository.ts";

// 権限はここに書かない(src/authz/policy.ts の ROUTE_RULES と docs/authz/matrix.yaml)。
// file:read・file:write は関所のトランザクションの外(署名に STS を待つことがある。ADR 0079):
// DB は外(app.ts)が渡す inTenant で短いトランザクションを開き、閉じてから署名する。file:delete はいつもどおりトランザクションの中。
// 署名つき URL はログに出さない(応答にだけ入れる)。

const TaskParams = z.object({ taskId: IdSchema });
const FileParams = z.object({ fileId: IdSchema });

const listRoute = createRoute({
  method: "get",
  path: "/tasks/{taskId}/files",
  tags: ["files"],
  summary: "タスクのファイル(古い順)。見られる物には5分の URL が付く",
  request: { params: TaskParams, query: PageQuery },
  responses: {
    200: json(FilePageSchema, "一覧"),
    ...badRequestError,
    ...authErrors,
    ...notFoundError,
  },
});

const createFileRoute = createRoute({
  method: "post",
  path: "/tasks/{taskId}/files",
  tags: ["files"],
  summary: "ファイルを上げる準備(5分の PUT の URL を返す。上げたら complete を呼ぶ)",
  request: { params: TaskParams, body: jsonBody(CreateFileSchema) },
  responses: {
    201: json(CreatedFileSchema, "作った(まだ pending)"),
    ...bodyErrors,
    ...authErrors,
    ...notFoundError,
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/files/{fileId}",
  tags: ["files"],
  summary: "ファイルを1件(見られる物には5分の URL が付く。期限が切れたら、もう一度呼ぶ)",
  request: { params: FileParams },
  responses: {
    200: json(FileSchema, "見つかった"),
    ...badRequestError,
    ...authErrors,
    ...notFoundError,
  },
});

const completeRoute = createRoute({
  method: "post",
  path: "/files/{fileId}/complete",
  tags: ["files"],
  summary: "上げ終えた(上げた本人だけ)。中身を確かめてから見られるようになる(2回呼んでも同じ)",
  request: { params: FileParams },
  responses: {
    202: json(FileSchema, "受け付けた(いまの状態)"),
    ...badRequestError,
    ...authErrors,
    ...notFoundError,
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/files/{fileId}",
  tags: ["files"],
  summary: "ファイルを消す(上げた本人か管理者。中身は後から消える)",
  request: { params: FileParams },
  responses: {
    204: { description: "消した" },
    ...badRequestError,
    ...authErrors,
    ...notFoundError,
  },
});

export type FileRouteDeps = { inTenant: InTenantTx; store: ObjectStore | null };

const unavailable = () =>
  new ApiError(503, "file_storage_unavailable", "ファイルの置き場が設定されていません");

/** ready の行に5分の見る URL を付ける */
async function withDownload(store: ObjectStore, row: FileRow): Promise<FileView> {
  const view = toFileView(row);
  if (row.status !== "ready") return view;
  const signed = await store.presignDownload(row.tenantId, row.id);
  return { ...view, downloadUrl: signed.url, downloadExpiresAt: signed.expiresAt.toISOString() };
}

export function fileRoutes(deps: FileRouteDeps) {
  const storeOf = () => {
    if (!deps.store) throw unavailable();
    return deps.store;
  };
  /** 関所の外で、セッションの組織の短いトランザクションを開く(組織はセッションからだけ。T-1) */
  const inTenant = <T>(c: Context<AppEnv>, fn: (s: TenantScope) => Promise<T>) => {
    const { tenantId, userId } = c.get("actor");
    return deps.inTenant(tenantId, (tx) => fn({ tx, tenantId, userId }));
  };

  return createRouter()
    .openapi(listRoute, async (c) => {
      const store = storeOf();
      const { taskId } = c.req.valid("param");
      const page = await inTenant(c, async (s) =>
        (await taskExists(s, taskId)) ? listFiles(s, taskId, c.req.valid("query")) : null,
      );
      if (!page) throw notFound();
      const items = await Promise.all(page.rows.map((r) => withDownload(store, r)));
      return c.json({ files: items, nextCursor: page.nextCursor }, 200);
    })
    .openapi(createFileRoute, async (c) => {
      const store = storeOf();
      const { taskId } = c.req.valid("param");
      const input = c.req.valid("json");
      const row = await inTenant(c, async (s) =>
        (await taskExists(s, taskId)) ? createFile(s, taskId, input) : null,
      );
      if (!row) throw notFound();
      const upload = await store.presignUpload(row.tenantId, row.id, input);
      const { url, headers } = upload;
      const expiresAt = upload.expiresAt.toISOString();
      return c.json(
        { ...toFileView(row), upload: { url, method: "PUT" as const, headers, expiresAt } },
        201,
      );
    })
    .openapi(getRoute, async (c) => {
      const store = storeOf();
      const row = await inTenant(c, (s) => findFile(s, c.req.valid("param").fileId));
      if (!row) throw notFound();
      return c.json(await withDownload(store, row), 200);
    })
    .openapi(completeRoute, async (c) => {
      storeOf();
      const actor = c.get("actor");
      const row = await inTenant(c, async (s) => {
        const file = await findFile(s, c.req.valid("param").fileId);
        if (!file) throw notFound();
        if (!canTouchFile(actor, "complete", file)) throw forbidden();
        await requestProcessing(s, file);
        return file;
      });
      return c.json(toFileView(row), 202);
    })
    .openapi(deleteRoute, async (c) => {
      const s = scopeOf(c);
      const file = await findFile(s, c.req.valid("param").fileId);
      if (!file) throw notFound();
      if (!canTouchFile(c.get("actor"), "delete", file)) throw forbidden();
      await deleteFile(s, file.id);
      return c.body(null, 204);
    });
}

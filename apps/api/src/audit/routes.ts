import { AuditEventPageSchema } from "@app/shared";
import { createRoute, z } from "@hono/zod-openapi";
import { scopeOf } from "../db/scope.ts";
import { authErrors, badRequestError, createRouter, json } from "../http/common.ts";
import { listAuditEvents } from "./repository.ts";

// 権限はここに書かない(src/authz/policy.ts の ROUTE_RULES と docs/authz/matrix.yaml)。
const ListQuery = z.object({
  before: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const auditRoutes = createRouter().openapi(
  createRoute({
    method: "get",
    path: "/audit-events",
    tags: ["audit"],
    summary: "自社の監査ログ(新しい順。管理者だけ)",
    request: { query: ListQuery },
    responses: {
      200: json(AuditEventPageSchema, "一覧"),
      ...badRequestError,
      ...authErrors,
    },
  }),
  async (c) => {
    const { before, limit } = c.req.valid("query");
    return c.json(await listAuditEvents(scopeOf(c), { before, limit }), 200);
  },
);

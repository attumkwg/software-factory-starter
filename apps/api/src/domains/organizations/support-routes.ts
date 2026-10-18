import {
  CreatedSupportGrantSchema,
  CreateSupportGrantSchema,
  IdSchema,
  SupportGrantSchema,
} from "@app/shared";
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
} from "../../http/common.ts";
import { createSupportGrant, listSupportGrants, revokeSupportGrant } from "./support.ts";

// サポートへの許可(お客さんの管理者。docs/specs/0004-support-access.md)。
// 社員が入る・出るは、組織を切り替えるので認証の側(src/auth/support-routes.ts)。
// 権限はここに書かない(src/authz/policy.ts の ROUTE_RULES と docs/authz/matrix.yaml)。

const GrantParams = z.object({ grantId: IdSchema });

export function supportGrantRoutes() {
  return (
    createRouter()
      // ── お客さんの管理者 ──
      .openapi(
        createRoute({
          method: "get",
          path: "/support-grants",
          tags: ["support"],
          summary: "サポートへの許可の一覧(新しい順に20件。番号は出ない)",
          responses: {
            200: json(z.object({ grants: z.array(SupportGrantSchema) }), "一覧"),
            ...authErrors,
          },
        }),
        async (c) => c.json({ grants: await listSupportGrants(scopeOf(c)) }, 200),
      )
      .openapi(
        createRoute({
          method: "post",
          path: "/support-grants",
          tags: ["support"],
          summary: "サポートに見せるのを許可する(番号はこの応答にだけ出る)",
          request: { body: jsonBody(CreateSupportGrantSchema) },
          responses: {
            201: json(CreatedSupportGrantSchema, "許可した"),
            ...bodyErrors,
            ...authErrors,
          },
        }),
        async (c) => c.json(await createSupportGrant(scopeOf(c), c.req.valid("json").hours), 201),
      )
      .openapi(
        createRoute({
          method: "delete",
          path: "/support-grants/{grantId}",
          tags: ["support"],
          summary: "許可を取り消す(入っている社員も、次のリクエストから入れない)",
          request: { params: GrantParams },
          responses: {
            204: { description: "取り消した" },
            ...badRequestError,
            ...authErrors,
            ...notFoundError,
          },
        }),
        async (c) => {
          const ok = await revokeSupportGrant(scopeOf(c), c.req.valid("param").grantId);
          if (!ok) throw notFound();
          return c.body(null, 204);
        },
      )
  );
}

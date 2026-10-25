import {
  CreateInvitationSchema,
  IdSchema,
  InvitationPageSchema,
  InvitationSchema,
} from "@app/shared";
import { createRoute, z } from "@hono/zod-openapi";
import { scopeOf } from "../../db/scope.ts";
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
import { createInvitation, listInvitations, revokeInvitation } from "./invitations.ts";

// 招待(組織の管理者。docs/specs/0027-invitations.md)。招かれた人が受ける API は、ログインの前なので認証の側
// (src/auth/invitation-routes.ts)。権限はここに書かない(src/authz/policy.ts の ROUTE_RULES と docs/authz/matrix.yaml)。

const InvitationParams = z.object({ invitationId: IdSchema });
const conflictError = { 409: json(z.any(), "もういる・招待がある・上限・もう受けた") };

export const invitationRoutes = createRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/invitations",
      tags: ["invitations"],
      summary: "招待の一覧(新しい順。受けた・期限切れ・取り消しも)",
      request: { query: PageQuery },
      responses: { 200: json(InvitationPageSchema, "一覧"), ...badRequestError, ...authErrors },
    }),
    async (c) => c.json(await listInvitations(scopeOf(c), c.req.valid("query")), 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/invitations",
      tags: ["invitations"],
      summary: "人を招く(招待のメールが届く。リンクは期限つき・1回きり)",
      request: { body: jsonBody(CreateInvitationSchema) },
      responses: {
        201: json(InvitationSchema, "招いた"),
        ...bodyErrors,
        ...authErrors,
        ...conflictError,
      },
    }),
    async (c) => c.json(await createInvitation(scopeOf(c), c.req.valid("json")), 201),
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/invitations/{invitationId}",
      tags: ["invitations"],
      summary: "招待を取り消す(リンクはすぐ使えなくなる)",
      request: { params: InvitationParams },
      responses: {
        204: { description: "取り消した" },
        ...badRequestError,
        ...authErrors,
        ...notFoundError,
        ...conflictError,
      },
    }),
    async (c) => {
      await revokeInvitation(scopeOf(c), c.req.valid("param").invitationId);
      return c.body(null, 204);
    },
  );

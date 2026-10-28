import {
  IdSchema,
  OrganizationMemberPageSchema,
  OrganizationMemberSchema,
  PutMemberRoleSchema,
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
import {
  changeMemberRole,
  disableMember,
  enableMember,
  listMembers,
  signOutMember,
} from "./members.ts";

// 組織の人(管理者・全部の組織。docs/specs/0079-member-admin.md・0056-sso-scim-ip-audit-export.md):
// 一覧・強制ログアウト・止める(外す)・戻す・ロールを変える。
// 権限はここに書かない(src/authz/policy.ts の ROUTE_RULES と docs/authz/matrix.yaml)。

const tags = ["organization"];
const MemberParams = z.object({ memberId: IdSchema });

/** 変える操作で返しうる物(自分・有効な管理者が0人・緊急用が0人は 409) */
const changeErrors = { ...badRequestError, ...authErrors, ...notFoundError, ...conflictError };

export const memberRoutes = createRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/organization/members",
      tags,
      summary: "【管理者】組織の人(古い順に1ページずつ。止めた人も出る)",
      request: { query: PageQuery },
      responses: {
        200: json(OrganizationMemberPageSchema, "一覧"),
        ...badRequestError,
        ...authErrors,
      },
    }),
    async (c) => c.json(await listMembers(scopeOf(c), c.req.valid("query")), 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/organization/members/{memberId}/sign-out",
      tags,
      summary:
        "【管理者】その人を強制ログアウトする(この組織の全部の端末が、次のリクエストから入れない)",
      request: { params: MemberParams },
      responses: {
        204: { description: "切った" },
        ...badRequestError,
        ...authErrors,
        ...notFoundError,
      },
    }),
    async (c) => {
      if (!(await signOutMember(scopeOf(c), c.req.valid("param").memberId))) throw notFound();
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/organization/members/{memberId}/role",
      tags,
      summary:
        "【管理者】ロールを変える(次のリクエストから効く)。自分は変えられない(409)。管理者から外すと緊急用からも外れる",
      request: { params: MemberParams, body: jsonBody(PutMemberRoleSchema) },
      responses: { 200: json(OrganizationMemberSchema, "変えた"), ...bodyErrors, ...changeErrors },
    }),
    async (c) => {
      const { memberId } = c.req.valid("param");
      return c.json(await changeMemberRole(scopeOf(c), memberId, c.req.valid("json").role), 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/organization/members/{memberId}/disable",
      tags,
      summary:
        "【管理者】止める(外す)。ログインできず、契約の人数にも数えない。行・作った物・記録は残り、戻せる。自分は止められない(409)",
      request: { params: MemberParams },
      responses: { 200: json(OrganizationMemberSchema, "止めた"), ...changeErrors },
    }),
    async (c) => c.json(await disableMember(scopeOf(c), c.req.valid("param").memberId), 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/organization/members/{memberId}/enable",
      tags,
      summary: "【管理者】止めた人を戻す(前のロールで入れる。人数の上限は見ない)",
      request: { params: MemberParams },
      responses: { 200: json(OrganizationMemberSchema, "戻した"), ...changeErrors },
    }),
    async (c) => c.json(await enableMember(scopeOf(c), c.req.valid("param").memberId), 200),
  );

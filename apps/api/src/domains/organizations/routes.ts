import { MeSchema } from "@app/shared";
import { createRoute } from "@hono/zod-openapi";
import { scopeOf } from "../../db/scope.ts";
import { unauthorized } from "../../errors.ts";
import { authErrors, createRouter, json } from "../../http/common.ts";
import { getMe } from "./repository.ts";
import { getSupportMe } from "./support.ts";

export const organizationRoutes = createRouter().openapi(
  createRoute({
    method: "get",
    path: "/me",
    tags: ["auth"],
    summary: "ログイン中の自分",
    responses: { 200: json(MeSchema, "自分"), ...authErrors },
  }),
  async (c) => {
    const actor = c.get("actor");
    // 代理の社員は、見ている組織の閲覧者として返す(画面は上に帯を出す)
    if (actor.support) {
      const me = await getSupportMe(c.get("tx"), actor.tenantId, actor.support.sessionId);
      if (!me) throw unauthorized();
      return c.json(me, 200);
    }
    const me = await getMe(scopeOf(c));
    if (!me) throw unauthorized();
    const supportTenantId = c.get("supportTenantId");
    return c.json({ ...me, isSupportStaff: supportTenantId === me.tenantId }, 200);
  },
);

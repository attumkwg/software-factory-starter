import { OrganizationPlanSchema } from "@app/shared";
import { createRoute } from "@hono/zod-openapi";
import { authErrors, createRouter, json } from "../http/common.ts";
import { getOrganizationPlan } from "./repository.ts";

// 組織のいまのプランと人数(docs/specs/0047-plans.md)。管理者だけ(policy.ts の plan:read)。
// 変えるのは運営のコマンドだけ(API は作らない。契約は申込書と会計ソフトが正で、画面の鍵1本で変えられないようにする)。

export const planRoutes = createRouter().openapi(
  createRoute({
    method: "get",
    path: "/organization/plan",
    tags: ["organization"],
    summary: "【管理者】この組織のプラン・人数の上限・いる人と受けていない招待の数",
    responses: { 200: json(OrganizationPlanSchema, "プランと人数"), ...authErrors },
  }),
  async (c) =>
    c.json(await getOrganizationPlan(c.get("tx"), c.get("actor").tenantId, c.get("plans")), 200),
);

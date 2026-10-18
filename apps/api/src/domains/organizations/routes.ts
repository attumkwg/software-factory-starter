import { MeSchema } from "@app/shared";
import { createRoute } from "@hono/zod-openapi";
import { scopeOf } from "../../db/scope.ts";
import { unauthorized } from "../../errors.ts";
import { authErrors, createRouter, json } from "../../http/common.ts";
import { getMe } from "./repository.ts";

export const organizationRoutes = createRouter().openapi(
  createRoute({
    method: "get",
    path: "/me",
    tags: ["auth"],
    summary: "ログイン中の自分",
    responses: { 200: json(MeSchema, "自分"), ...authErrors },
  }),
  async (c) => {
    const me = await getMe(scopeOf(c));
    if (!me) throw unauthorized();
    return c.json(me, 200);
  },
);

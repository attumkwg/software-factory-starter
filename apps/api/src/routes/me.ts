import { MeSchema } from "@app/shared";
import { createRoute } from "@hono/zod-openapi";
import { unauthorized } from "../errors.ts";
import { getMe } from "../repositories/me.ts";
import { scopeOf } from "../repositories/scope.ts";
import { authErrors, createRouter, json } from "./common.ts";

export const meRoutes = createRouter().openapi(
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

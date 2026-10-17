import { ErrorSchema } from "@app/shared";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { z } from "zod";
import type { AppEnv } from "../env.ts";
import { getRequestContext } from "../request-context.ts";

export const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

const error = (description: string) => json(ErrorSchema, description);

/** ログインが要る API に付ける共通の失敗。 */
export const authErrors = {
  401: error("ログインしていない"),
  403: error("権限が無い"),
} as const;
export const notFoundError = { 404: error("無い(他社の物も 404)") } as const;
export const badRequestError = { 400: error("入力が正しくない") } as const;

/** ルートを作る入口。入力の検証に失敗したら共通の形で 400 を返す。 */
export function createRouter() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          {
            error: {
              code: "bad_request",
              message: result.error.issues
                .map((i) => `${i.path.join(".") || "(本文)"}: ${i.message}`)
                .join("; "),
              requestId: getRequestContext()?.requestId,
            },
          },
          400,
        );
      }
    },
  });
}

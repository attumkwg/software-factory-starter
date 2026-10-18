import { ErrorSchema } from "@app/shared";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { z } from "zod";
import type { AppEnv } from "../env.ts";
import { getRequestContext } from "../request-context.ts";

export const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

/**
 * 必須の JSON の本文。**本文は必ずこれで書く**。
 * required を付けないと、本文が無い・content-type が違うリクエストが検証を素通りする
 * (Schemathesis が見つけた 500。test/integration/input-validation.int.test.ts)。
 */
export const jsonBody = <T extends z.ZodType>(schema: T) => ({
  content: { "application/json": { schema } },
  required: true,
});

const error = (description: string) => json(ErrorSchema, description);

/** ログインが要る API に付ける共通の失敗(どの API でも起きうる 500 / 503 も載せる)。 */
export const authErrors = {
  401: error("ログインしていない"),
  403: error("権限が無い"),
  500: error("想定外の失敗(中身は返さない。requestId でログを引く)"),
  503: error("DB などが一時的に使えない(Retry-After の秒数を待って、やり直す)"),
} as const;
export const notFoundError = { 404: error("無い(他社の物も 404)") } as const;
export const badRequestError = { 400: error("入力が正しくない") } as const;
export const conflictError = {
  409: error("ほかの変更とぶつかった(読み直して、やり直す)"),
} as const;
/** 本文(jsonBody)がある API に付ける失敗。本文が JSON でなければ 415、1MB を超えれば 413。 */
export const bodyErrors = {
  400: error("入力が正しくない・本文が無い"),
  413: error("本文が大きすぎる(1MB まで)"),
  415: error("本文が JSON ではない"),
} as const;

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

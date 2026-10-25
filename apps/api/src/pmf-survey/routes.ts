import { PmfSurveyResponseSchema, PmfSurveyStatusSchema } from "@app/shared";
import { createRoute } from "@hono/zod-openapi";
import {
  authErrors,
  bodyErrors,
  conflictError,
  createRouter,
  json,
  jsonBody,
  notFoundError,
} from "../http/common.ts";
import { recordAnswer, surveyStatus } from "./repository.ts";

// 「無くなったら困るか」を画面の中で聞く(docs/specs/0046-pmf-survey.md)。権限は policy.ts の me:read と pmf_survey:answer。

export const pmfSurveyRoutes = createRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/pmf-survey",
      tags: ["pmf-survey"],
      summary: "いまこの人に「無くなったら困るか」を聞くか(聞かないときも 200 で ask: false)",
      responses: {
        200: json(PmfSurveyStatusSchema, "聞くか・いまの回"),
        ...authErrors,
      },
    }),
    async (c) => c.json(await surveyStatus(c), 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/pmf-survey",
      tags: ["pmf-survey"],
      summary: "答える(数に1つ足すだけ。だれが何と答えたかは残さない。1人1回・四半期ごと)",
      request: { body: jsonBody(PmfSurveyResponseSchema) },
      responses: {
        204: { description: "数えた" },
        ...bodyErrors,
        ...authErrors,
        ...notFoundError,
        ...conflictError,
      },
    }),
    async (c) => {
      await recordAnswer(c, c.req.valid("json").answer);
      return c.body(null, 204);
    },
  );

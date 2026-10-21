import { canAccept, LegalConsentRequestSchema } from "@app/shared";
import { createRoute } from "@hono/zod-openapi";
import { scopeOf } from "../../db/scope.ts";
import { badRequest } from "../../errors.ts";
import { authErrors, bodyErrors, createRouter, jsonBody } from "../../http/common.ts";
import { recordConsents } from "./repository.ts";

// 利用規約・プライバシーポリシーへの同意(docs/specs/0008-legal-consent.md)。権限は policy.ts の legal:accept。
// 同意が要る間(関所の 403 terms_acceptance_required)でも、この API は通る。

export const legalRoutes = createRouter().openapi(
  createRoute({
    method: "post",
    path: "/legal/consents",
    tags: ["legal"],
    summary:
      "利用規約・プライバシーポリシーの版に同意する(組織としてか本人としてかはロールで決まる)",
    request: { body: jsonBody(LegalConsentRequestSchema) },
    responses: {
      204: { description: "記録した(同じ版への2回目は何もしない)" },
      ...bodyErrors,
      ...authErrors,
    },
  }),
  async (c) => {
    const { consents } = c.req.valid("json");
    const now = new Date();
    const versions = c.get("legalVersions");
    // 公開済みで、いまの版かそれより後の版だけ(無い版・公開前・古い版は、1つでもあれば全部を記録しない)
    if (!consents.every((ref) => canAccept(ref, now, versions))) {
      throw badRequest("同意できる版ではありません");
    }
    await recordConsents(scopeOf(c), { consents, role: c.get("actor").role, source: "acceptance" });
    return c.body(null, 204);
  },
);

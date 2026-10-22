import { MeSchema } from "@app/shared";
import { createRoute } from "@hono/zod-openapi";
import { scopeOf } from "../../db/scope.ts";
import { unauthorized } from "../../errors.ts";
import { authErrors, createRouter, json } from "../../http/common.ts";
import { findAccess } from "./account.ts";
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
    const scope = scopeOf(c);
    const me = await getMe(scope);
    const access = await findAccess(scope.tx, scope.tenantId, scope.userId);
    if (!me || !access) throw unauthorized();
    const supportTenantId = c.get("supportTenantId");
    // 二段階認証の設定待ちなら、画面は /account へ回す(docs/specs/0006-account-security.md)
    const mfa = {
      enabled: access.mfaEnabled,
      required: access.mfaRequired,
      setupRequired: c.get("mfaEnforced") && access.mfaRequired && !access.mfaEnabled,
    };
    // 規約の同意(関所が引いて置いた物。docs/specs/0009-legal-consent.md)。pending なら画面は /legal/accept へ回す
    const legal = c.get("legalStatus");
    return c.json(
      { ...me, isSupportStaff: supportTenantId === me.tenantId, mfa, ...(legal ? { legal } : {}) },
      200,
    );
  },
);

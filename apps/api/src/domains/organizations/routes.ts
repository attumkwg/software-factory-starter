import { MeSchema } from "@app/shared";
import { createRoute } from "@hono/zod-openapi";
import { scopeOf } from "../../db/scope.ts";
import { unauthorized } from "../../errors.ts";
import { findEnabledFeatures } from "../../feature-flags/index.ts";
import { authErrors, createRouter, json } from "../../http/common.ts";
import { findAccess } from "./account.ts";
import { findMemberships, findPersonKey } from "./memberships.ts";
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
    // この組織で入っている機能(docs/specs/0012-feature-flags-and-usage.md)。代理の社員にも同じ一覧
    const features = await findEnabledFeatures(
      c.get("tx"),
      actor.tenantId,
      c.get("featureFlags"),
      c.get("plans"),
    );
    // 代理の社員は、見ている組織の閲覧者として返す(画面は上に帯を出す)
    if (actor.support) {
      const me = await getSupportMe(c.get("tx"), actor.tenantId, actor.support.sessionId);
      if (!me) throw unauthorized();
      return c.json({ ...me, features }, 200);
    }
    const scope = scopeOf(c);
    const me = await getMe(scope);
    const access = await findAccess(scope.tx, scope.tenantId, scope.userId);
    if (!me || !access) throw unauthorized();
    const supportTenantId = c.get("supportTenantId");
    // 所属している組織の数(2つ以上なら画面が切り替えを出す。docs/specs/0055-multi-org-membership.md)
    const key = await findPersonKey(scope.tx, scope.tenantId, scope.userId);
    const organizationsCount = key ? (await findMemberships(scope.tx, key)).length : 1;
    // 二段階認証の設定待ちなら、画面は /account へ回す(docs/specs/0006-account-security.md)
    const mfa = {
      enabled: access.mfaEnabled,
      required: access.mfaRequired,
      setupRequired: c.get("mfaEnforced") && access.mfaRequired && !access.mfaEnabled,
    };
    // 規約の同意(関所が引いて置いた物。docs/specs/0009-legal-consent.md)。pending なら画面は /legal/accept へ回す
    const legal = c.get("legalStatus");
    return c.json(
      {
        ...me,
        isSupportStaff: supportTenantId === me.tenantId,
        organizationsCount,
        mfa,
        ...(legal ? { legal } : {}),
        features,
      },
      200,
    );
  },
);

import { MfaRequirementSchema } from "@app/shared";
import { createRoute } from "@hono/zod-openapi";
import { scopeOf } from "../../db/scope.ts";
import { ApiError } from "../../errors.ts";
import { authErrors, conflictError, createRouter, json } from "../../http/common.ts";
import { findAccess, getMfaRequirement, setMfaRequired } from "./account.ts";

// 組織の二段階認証の必須(docs/specs/0006-account-security.md)。管理者だけ(policy.ts の mfa_requirement:manage)。
// 入れる・切るを POST / DELETE に分けて、監査ログの名前で向きが分かるようにする(details に値を入れない決まりのまま)。

const tags = ["organization"];
const changed = { 204: { description: "変えた(すぐ効く。未設定の人は次の操作で設定へ回される)" } };

export const mfaRequirementRoutes = createRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/organization/mfa-requirement",
      tags,
      summary: "【管理者】二段階認証の必須の状態と、まだ設定していない人の数",
      responses: { 200: json(MfaRequirementSchema, "状態"), ...authErrors },
    }),
    async (c) => c.json(await getMfaRequirement(scopeOf(c)), 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/organization/mfa-requirement",
      tags,
      summary: "【管理者】この組織では全員に二段階認証を必須にする(自分が設定済みのときだけ)",
      responses: { ...changed, ...authErrors, ...conflictError },
    }),
    async (c) => {
      const scope = scopeOf(c);
      const me = await findAccess(scope.tx, scope.tenantId, scope.userId);
      // 入れた本人が締め出されないように(開発用ログインでは設定する道が無いので見ない)
      if (c.get("mfaEnforced") && !me?.mfaEnabled) {
        throw new ApiError(409, "mfa_not_enabled", "先に自分の二段階認証を設定してください");
      }
      await setMfaRequired(scope, true);
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/organization/mfa-requirement",
      tags,
      summary: "【管理者】二段階認証の必須を切る(運営の組織では切れない)",
      responses: { ...changed, ...authErrors, ...conflictError },
    }),
    async (c) => {
      const scope = scopeOf(c);
      // 運営の組織は最初から必須で、切れない(設計書 0006 の U-7)。社員の守りを1人の操作で外させない
      if (scope.tenantId === c.get("supportTenantId")) {
        throw new ApiError(409, "support_org_requires_mfa", "運営の組織では必須を切れません");
      }
      await setMfaRequired(scope, false);
      return c.body(null, 204);
    },
  );

import { IdSchema, OrganizationDomainSchema } from "@app/shared";
import { createRoute, z } from "@hono/zod-openapi";
import type { RootDb } from "../db/client.ts";
import { withTenant } from "../db/tenant.ts";
import {
  findDomain,
  hasVerifyRecord,
  markDomainVerified,
  securityRoutes,
} from "../domains/organizations/index.ts";
import { ApiError, notFound } from "../errors.ts";
import { isFeatureEnabled } from "../feature-flags/index.ts";
import {
  authErrors,
  badRequestError,
  conflictError,
  createRouter,
  json,
  notFoundError,
} from "../http/common.ts";

// 会社のドメインを DNS の TXT で確かめる(管理者。docs/specs/0056-sso-scim-ip-audit-export.md・T-8)。
// DNS は外なので、関所のトランザクションの外で待つ(policy.ts の OUTSIDE_TRANSACTION。apps/api/CLAUDE.md の DB の時間切れ)。
// 読む・書くはそれぞれ短いトランザクション(組織はセッションの actor から)。ほかのドメインの API は領域の security-routes.ts。

/** DNS の TXT を引く(テストは差し替える)。見つからない・引けないときは投げる(空と同じに扱う) */
export type ResolveTxt = (name: string) => Promise<string[][]>;

const DomainParams = z.object({ domainId: IdSchema });

/** 段1a の全部のルート(領域の securityRoutes と、ここの DNS で確かめる API)。app.ts は1行で足す */
export function organizationSecurityRoutes(deps: { db: RootDb; resolveTxt: ResolveTxt }) {
  return createRouter()
    .route("/", securityRoutes)
    .openapi(
      createRoute({
        method: "post",
        path: "/organization/domains/{domainId}/verify",
        tags: ["organization"],
        summary:
          "【管理者】DNS の TXT を見て、ドメインを確かめる(外を待つので、トランザクションの外)",
        request: { params: DomainParams },
        responses: {
          200: json(OrganizationDomainSchema, "確かめた"),
          ...badRequestError,
          ...authErrors,
          ...notFoundError,
          ...conflictError,
        },
      }),
      async (c) => {
        const { tenantId } = c.get("actor");
        const { domainId } = c.req.valid("param");
        const domain = await withTenant(deps.db, tenantId, async (tx) => {
          const enabled = await isFeatureEnabled(
            tx,
            tenantId,
            c.get("featureFlags"),
            "sso",
            c.get("plans"),
          );
          return enabled ? findDomain(tx, tenantId, domainId) : null;
        });
        if (!domain) throw notFound();
        const records = await deps.resolveTxt(domain.verifyRecord.name).catch(() => []);
        if (!hasVerifyRecord(records, domain)) {
          throw new ApiError(409, "domain_not_verified", "DNS にまだ確かめの文字が見えません");
        }
        const verified = await withTenant(deps.db, tenantId, (tx) =>
          markDomainVerified(tx, tenantId, domainId),
        );
        return c.json(verified, 200);
      },
    );
}

import { StartSupportSchema, SupportSessionSchema } from "@app/shared";
import { createRoute } from "@hono/zod-openapi";
import { recordAudit } from "../audit/record.ts";
import type { RootDb } from "../db/client.ts";
import { withTenant } from "../db/tenant.ts";
import {
  endSupportSession,
  findContact,
  findSupportGrantByCode,
  startSupportSession,
} from "../domains/organizations/index.ts";
import { ApiError, badRequest, forbidden } from "../errors.ts";
import {
  authErrors,
  badRequestError,
  bodyErrors,
  createRouter,
  json,
  jsonBody,
} from "../http/common.ts";
import { type SessionConfig, writeSession } from "./session.ts";

// 社員の代理ログイン: 入る・出る(docs/specs/0004-support-access.md・ADR 0014)。
// ログインと同じく「組織を切り替える」ので、領域ではなく認証の側に置く(見る組織の文脈を自分で開く)。
// 代理の最中かどうか・期限・取り消し・社員であることの確かめは、認可の関所(src/authz/middleware.ts)。
// 権限はここに書かない(src/authz/policy.ts の ROUTE_RULES と docs/authz/matrix.yaml)。

// どれが違ったか(番号・期限・取り消し)は言わない
const invalidSupportCode = () =>
  new ApiError(400, "invalid_code", "番号が違うか、期限が切れているか、取り消されています");

export function supportSessionRoutes(deps: { db: RootDb; session: SessionConfig }) {
  return createRouter()
    .openapi(
      createRoute({
        method: "post",
        path: "/support/sessions",
        tags: ["support"],
        summary: "【社員】サポート番号で、その組織を見るだけで入る",
        request: { body: jsonBody(StartSupportSchema) },
        responses: {
          201: json(SupportSessionSchema, "入った(Cookie が代理になる)"),
          ...bodyErrors,
          ...authErrors,
        },
      }),
      async (c) => {
        const actor = c.get("actor");
        const supportTenantId = c.get("supportTenantId");
        // 運営の組織の人だけ。代理の最中にさらに入ることはできない
        if (!supportTenantId || actor.tenantId !== supportTenantId || actor.support) {
          throw forbidden();
        }
        const grant = await findSupportGrantByCode(c.get("tx"), c.req.valid("json").code);
        if (!grant || grant.tenantId === actor.tenantId) throw invalidSupportCode();

        const staff = await findContact(c.get("tx"), actor.tenantId, actor.userId);
        if (!staff) throw forbidden();
        // 見る組織の文脈で、入室とお客さんの監査ログを残す(運営の組織の記録は関所が残す)
        const started = await withTenant(deps.db, grant.tenantId, async (tx) => {
          const s = await startSupportSession(tx, {
            tenantId: grant.tenantId,
            grantId: grant.grantId,
            grantExpiresAt: grant.expiresAt,
            staff: { userId: actor.userId, name: staff.name, email: staff.email },
          });
          await recordAudit(tx, {
            tenantId: grant.tenantId,
            actor: { kind: "support", id: actor.userId },
            action: "support.start",
            target: { type: "support_session", id: s.sessionId },
            outcome: "allowed",
          });
          return s;
        });
        // 代理に入っても、ログインした時刻は社員のふつうのログインのまま(12時間は延びない。ADR 0017)
        await writeSession(c, deps.session, {
          userId: actor.userId,
          tenantId: grant.tenantId,
          support: { sessionId: started.sessionId, homeTenantId: actor.tenantId },
          loggedInAt: c.get("session")?.loggedInAt,
        });
        return c.json(
          {
            id: started.sessionId,
            tenantName: started.tenantName,
            expiresAt: started.expiresAt.toISOString(),
          },
          201,
        );
      },
    )
    .openapi(
      createRoute({
        method: "post",
        path: "/support/end",
        tags: ["support"],
        summary: "【社員】代理ログインを終えて、本来の組織に戻る",
        responses: {
          204: { description: "終えた(Cookie が本来の組織に戻る)" },
          ...badRequestError,
          ...authErrors,
        },
      }),
      async (c) => {
        const session = c.get("session");
        const actor = c.get("actor");
        if (!session?.support || !actor.support) {
          throw badRequest("代理ログインの最中ではありません");
        }
        await endSupportSession(c.get("tx"), actor.tenantId, actor.support.sessionId);
        await writeSession(c, deps.session, {
          userId: session.userId,
          tenantId: session.support.homeTenantId,
          loggedInAt: session.loggedInAt,
        });
        return c.body(null, 204);
      },
    );
}

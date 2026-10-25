import { OrganizationMembershipListSchema, SwitchOrganizationSchema } from "@app/shared";
import { createRoute, z } from "@hono/zod-openapi";
import { MANUAL_AUDIT_ACTIONS, recordAudit } from "../audit/index.ts";
import type { RootDb } from "../db/client.ts";
import { withTenant } from "../db/tenant.ts";
import {
  findMemberships,
  findPersonKey,
  ipAllowedFor,
  ipNotAllowed,
  markMembershipUsed,
} from "../domains/organizations/index.ts";
import { forbidden, notFound, unauthorized } from "../errors.ts";
import { clientIp } from "../http/client-ip.ts";
import {
  authErrors,
  bodyErrors,
  createRouter,
  json,
  jsonBody,
  notFoundError,
} from "../http/common.ts";
import { type SessionConfig, writeSession } from "./session.ts";

// 所属している組織の一覧と、組織の選び直し(docs/specs/0055-multi-org-membership.md・ADR 0066)。
// 選び直しは、ログインと同じく「組織を決める」ので認証の側に置く(先の組織の文脈を自分で開く)。
// 本文の組織の ID は候補にすぎない。組織を決めるのは「セッションの人がその組織に所属しているか」を
// DB の関数(auth_find_memberships)で確かめた結果。Cookie は1組織分だけ有効(出し直す)。
// 権限はここに書かない(src/authz/policy.ts の ROUTE_RULES と docs/authz/matrix.yaml)。

const switched = json(z.object({ tenantId: z.string() }), "選び直した(Cookie を出し直す)");

export function organizationSwitchRoutes(deps: { db: RootDb; session: SessionConfig }) {
  return createRouter()
    .openapi(
      createRoute({
        method: "get",
        path: "/me/organizations",
        tags: ["auth"],
        summary: "本人が所属している組織(本人にだけ。名前の順)",
        responses: { 200: json(OrganizationMembershipListSchema, "一覧"), ...authErrors },
      }),
      async (c) => {
        const actor = c.get("actor");
        // 代理の社員が見ている組織は、社員の所属ではない
        if (actor.support) return c.json({ organizations: [] }, 200);
        const key = await findPersonKey(c.get("tx"), actor.tenantId, actor.userId);
        if (!key) throw unauthorized();
        const list = await findMemberships(c.get("tx"), key);
        const organizations = list
          .map((m) => ({
            tenantId: m.tenantId,
            name: m.tenantName,
            role: m.role,
            current: m.tenantId === actor.tenantId,
          }))
          .sort((a, b) => a.name.localeCompare(b.name, "ja"));
        return c.json({ organizations }, 200);
      },
    )
    .openapi(
      createRoute({
        method: "post",
        path: "/session/organization",
        tags: ["auth"],
        summary: "組織を選び直す(本人が所属している組織だけ。ほかは 404)",
        request: { body: jsonBody(SwitchOrganizationSchema) },
        responses: { 200: switched, ...bodyErrors, ...authErrors, ...notFoundError },
      }),
      async (c) => {
        const actor = c.get("actor");
        const session = c.get("session");
        // 代理の最中は選び直さない(policy.ts の NOT_DURING_SUPPORT でも止まる。二重の守り)
        if (actor.support || !session) throw forbidden();
        const key = await findPersonKey(c.get("tx"), actor.tenantId, actor.userId);
        if (!key) throw unauthorized();
        // 本文の組織は「選びたい先」の候補だけ。決めるのは下の所属の確かめ(本人の所属に無ければ 404)。ADR 0066
        // nosemgrep: semgrep.tenant-from-request -- 所属を確かめてから Cookie を出し直す(ログインと同じ扱い)
        const { tenantId } = c.req.valid("json");
        const target = (await findMemberships(c.get("tx"), key)).find(
          (m) => m.tenantId === tenantId,
        );
        // 所属していない組織は「無い」と答える(他社の存在を言わない)
        if (!target) throw notFound();
        // 先の組織の監査ログに「入った」と、前回の組織の印。元の組織の「出た」は関所が自動で残す(audit/actions.ts)
        const defs = { featureFlags: c.get("featureFlags"), plans: c.get("plans") };
        await withTenant(deps.db, target.tenantId, async (tx) => {
          // 先の組織が IP の範囲を決めていれば、ログインと同じく外からは入れない(設計書 0056 の 6)
          if (!(await ipAllowedFor(tx, target.tenantId, clientIp(c), defs))) throw ipNotAllowed();
          await markMembershipUsed(tx, target.tenantId, target.userId);
          await recordAudit(tx, {
            tenantId: target.tenantId,
            actor: { kind: "user", id: target.userId },
            action: MANUAL_AUDIT_ACTIONS.switchIn,
            outcome: "allowed",
          });
        });
        // ログインした時刻は引き継ぐ(最長12時間は延びない。設計書 0055 の U-2)
        await writeSession(c, deps.session, {
          userId: target.userId,
          tenantId: target.tenantId,
          loggedInAt: session.loggedInAt,
        });
        return c.json({ tenantId: target.tenantId }, 200);
      },
    );
}

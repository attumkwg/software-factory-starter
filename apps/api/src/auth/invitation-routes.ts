import { AcceptedInvitationSchema, AcceptInvitationSchema } from "@app/shared";
import { createRoute, z } from "@hono/zod-openapi";
import { MANUAL_AUDIT_ACTIONS, recordAudit } from "../audit/index.ts";
import type { RootDb } from "../db/client.ts";
import { acceptInvitation, verifyInvitationToken } from "../domains/organizations/index.ts";
import { ApiError } from "../errors.ts";
import { bodyErrors, createRouter, json, jsonBody } from "../http/common.ts";
import type { Logger } from "../logger.ts";

// 招待を受ける(ログインの前。docs/specs/0027-invitations.md・ADR 0040)。
// 組織は**リンクの札が指す招待**から決まる(ログインで、メールとパスワードから組織が決まるのと同じ)。
// リクエストの値で組織を選ばせない(本文は札と名前だけ)。受けても、ログインはさせない:
// その人は、招待のメールアドレスを Cognito で確かめて(登録 → 確認コード)ログインして、初めて入れる。

type Deps = { db: RootDb; logger: Logger; linkSecret: string };

const invalidInvitation = () =>
  new ApiError(
    400,
    "invalid_invitation",
    "招待のリンクが正しくないか、期限が切れているか、もう使われています",
  );

const acceptRoute = createRoute({
  method: "post",
  path: "/invitations/accept",
  tags: ["invitations"],
  summary: "招待を受ける(ログイン無しで。リンクは1回きり)",
  description:
    "札が正しく、招待が生きていれば、その組織に人を足す。どれが違ったか(署名・期限・使用済み・取り消し)は言わない。そのあと本人は招待のメールアドレスで登録・ログインする",
  request: { body: jsonBody(AcceptInvitationSchema) },
  responses: {
    200: json(AcceptedInvitationSchema, "受けた"),
    ...bodyErrors,
    409: json(z.any(), "メールアドレスがもうどこかの組織で使われている"),
  },
});

export function invitationAcceptRoutes(deps: Deps) {
  return createRouter().openapi(acceptRoute, async (c) => {
    const { token, name } = c.req.valid("json");
    const invitationId = verifyInvitationToken(deps.linkSecret, token);
    if (!invitationId) {
      deps.logger.info({ what: "accept_invitation", reason: "bad_token" }, "招待を受けられません");
      throw invalidInvitation();
    }
    const accepted = await acceptInvitation(deps.db, invitationId, name, (tx, a) =>
      recordAudit(tx, {
        tenantId: a.tenantId,
        actor: { kind: "user", id: a.userId },
        action: MANUAL_AUDIT_ACTIONS.invitationAccept,
        target: { type: "invitation", id: a.invitationId },
        outcome: "allowed",
      }),
    );
    if (!accepted) {
      deps.logger.info(
        { what: "accept_invitation", reason: "not_pending", invitationId },
        "招待を受けられません",
      );
      throw invalidInvitation();
    }
    deps.logger.info(
      { invitationId, userId: accepted.userId, loginTenantId: accepted.tenantId },
      "招待を受けました",
    );
    return c.json({ tenantName: accepted.tenantName, email: accepted.email }, 200);
  });
}

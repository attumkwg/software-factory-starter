import { canAccept, type LegalVersionRef } from "@app/shared";
import type { Context } from "hono";
import { MANUAL_AUDIT_ACTIONS, recordAudit } from "../audit/index.ts";
import { withTenant } from "../db/tenant.ts";
import { recordConsents } from "../domains/legal/index.ts";
import { findRole } from "../domains/organizations/index.ts";
import type { AppEnv } from "../env.ts";
import type { LoginDeps } from "./login.ts";
import { findLogin } from "./lookup.ts";

/**
 * 登録の画面で同意した版を記録する(docs/specs/0009-legal-consent.md)。**確認コードが通った後にだけ呼ぶ**
 * (メールの持ち主だと分かってから。他人のメールで登録を始めても、その人の同意にはならない)。
 *
 * - アプリにいない人(users に行が無い)・同意できない版は飛ばす。答えは変えない(いるかいないかを言わない)
 * - 記録に失敗しても登録は成功のまま(Cognito はもう確認済み。同意は次のログインで関所が取り直す)
 */
export async function recordSignUpConsents(
  deps: LoginDeps,
  c: Context<AppEnv>,
  email: string,
  consents: LegalVersionRef[] | undefined,
): Promise<void> {
  if (!consents?.length) return;
  const now = new Date();
  const acceptable = consents.filter((ref) => canAccept(ref, now, c.get("legalVersions")));
  if (acceptable.length < consents.length) {
    deps.logger.info(
      { what: "sign_up_consent", reason: "not_acceptable" },
      "同意できない版を飛ばしました",
    );
  }
  if (acceptable.length === 0) return;
  try {
    const user = await findLogin(deps.db, { kind: "email", email });
    if (!user) {
      deps.logger.info({ what: "sign_up_consent", reason: "not_registered" }, "同意は記録しません");
      return;
    }
    await withTenant(deps.db, user.tenantId, async (tx) => {
      const role = await findRole(tx, user.tenantId, user.userId);
      if (!role) return;
      const scope = { tx, tenantId: user.tenantId, userId: user.userId };
      await recordConsents(scope, { consents: acceptable, role, source: "sign_up" });
      await recordAudit(tx, {
        tenantId: user.tenantId,
        actor: { kind: "user", id: user.userId },
        action: MANUAL_AUDIT_ACTIONS.signUpConsent,
        outcome: "allowed",
        details: { route: "POST /api/auth/confirm-sign-up" },
      });
    });
  } catch (err) {
    deps.logger.error(
      { err },
      "登録のときの同意を記録できませんでした(次のログインで同意の画面が出る)",
    );
  }
}

import type {
  FeatureFlagDefinition,
  LegalStatus,
  LegalVersion,
  PlanDefinition,
  Role,
} from "@app/shared";
import type { TenantTx } from "./db/client.ts";
import type { SensitiveStore } from "./sensitive/index.ts";

/**
 * ログインのセッションから分かること。テナントはここからしか決めない(リクエストの値で決めない)。
 * support があるときは、社員の代理ログイン(docs/specs/0004-support-access.md)の最中:
 *   tenantId … 見ている組織(許可した組織) / userId … 社員 / support.homeTenantId … 社員の本来の組織
 */
export type Session = {
  userId: string;
  tenantId: string;
  support?: { sessionId: string; homeTenantId: string };
  /**
   * "sso" … この組織の IdP(SSO)で入った。SSO を必須にした組織に入れるのはこれだけ(緊急用を除く)。
   * 二段階認証は IdP の役目なので、組織の必須を当てない(docs/designs/0056-sso-scim-ip-audit-export.md の 6)。
   * 組織を切り替えると外れる(SSO で確かめたのは入った組織だけ)
   */
  via?: "sso";
  /** ログインした時刻(UNIX 秒)。ここから最長(既定12時間)で切れる(ADR 0017) */
  loggedInAt: number;
  /** この Cookie の期限(UNIX 秒)。使っている間は関所が出し直して延ばす */
  expiresAt: number;
};

/** これから出すセッション。loggedInAt が無ければ「いまログインした」(auth/session.ts の writeSession) */
export type NewSession = Omit<Session, "loggedInAt" | "expiresAt"> & { loggedInAt?: number };

/** 認可を通ったあとの「誰が」。代理の社員なら support があり、role は閲覧者に固定。 */
export type Actor = {
  userId: string;
  tenantId: string;
  role: Role;
  support?: { sessionId: string };
};

export type AppEnv = {
  Variables: {
    session: Session | null;
    actor: Actor;
    /** テナントの文脈つきのトランザクション(src/authz/middleware.ts が開く) */
    tx: TenantTx;
    /** 運営の組織(SUPPORT_TENANT_ID)。社員かどうかの判断に使う。無ければ null(代理ログインを使わない) */
    supportTenantId: string | null;
    /**
     * 組織の二段階認証の必須を、関所が効かせるか(Cognito のときだけ。開発用ログインでは設定する道が無い)。
     * docs/specs/0006-account-security.md
     */
    mfaEnforced: boolean;
    /** いまの人の IP をどのヘッダーの右から何個目で読むか(src/http/client-ip.ts。設定の CLIENT_IP_HEADER・TRUSTED_PROXY_HOPS) */
    clientIpSource: { header: string; hops: number };
    /** 利用規約・プライバシーポリシーの版の一覧(既定は @app/shared の LEGAL_VERSIONS。結合テストが差し替える) */
    legalVersions: readonly LegalVersion[];
    /**
     * 本人の同意の状態(関所が引いて置く。GET /api/me が返す)。代理の最中・運営の組織の人は無い。
     * docs/specs/0009-legal-consent.md
     */
    legalStatus?: LegalStatus;
    /** 機能フラグの定義(既定は @app/shared の FEATURE_FLAGS。結合テストが差し替える。docs/specs/0012-feature-flags-and-usage.md) */
    featureFlags: readonly FeatureFlagDefinition[];
    /** プランの定義(既定は @app/shared の PLANS。結合テストが差し替える。docs/specs/0047-plans.md) */
    plans: readonly PlanDefinition[];
    /** 要配慮個人情報の入口(ADR 0029)。要配慮の接続が無い環境では null。ルートからは sensitiveOf(c) で */
    sensitive: SensitiveStore | null;
    /**
     * 情シスの道具(SCIM)の入口だけ: 鍵で決まった組織と鍵の ID(src/auth/scim-routes.ts が置く。セッションは使わない)。
     * docs/designs/0056-sso-scim-ip-audit-export.md の 3
     */
    scim?: { tenantId: string; tokenId: string };
  };
};

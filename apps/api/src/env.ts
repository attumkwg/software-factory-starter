import type { LegalStatus, LegalVersion, Role } from "@app/shared";
import type { TenantTx } from "./db/client.ts";

/**
 * ログインのセッションから分かること。テナントはここからしか決めない(リクエストの値で決めない)。
 * support があるときは、社員の代理ログイン(docs/specs/0004-support-access.md)の最中:
 *   tenantId … 見ている組織(許可した組織) / userId … 社員 / support.homeTenantId … 社員の本来の組織
 */
export type Session = {
  userId: string;
  tenantId: string;
  support?: { sessionId: string; homeTenantId: string };
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
    /** 利用規約・プライバシーポリシーの版の一覧(既定は @app/shared の LEGAL_VERSIONS。結合テストが差し替える) */
    legalVersions: readonly LegalVersion[];
    /**
     * 本人の同意の状態(関所が引いて置く。GET /api/me が返す)。代理の最中・運営の組織の人は無い。
     * docs/specs/0009-legal-consent.md
     */
    legalStatus?: LegalStatus;
  };
};

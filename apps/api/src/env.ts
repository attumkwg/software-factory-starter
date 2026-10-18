import type { Role } from "@app/shared";
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
};

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
  };
};

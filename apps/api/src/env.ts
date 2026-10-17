import type { Role } from "@app/shared";
import type { TenantTx } from "./db/client.ts";

/** ログインのセッションから分かること。テナントはここからしか決めない(リクエストの値で決めない)。 */
export type Session = { userId: string; tenantId: string };

/** 認可を通ったあとの「誰が」。 */
export type Actor = { userId: string; tenantId: string; role: Role };

export type AppEnv = {
  Variables: {
    session: Session | null;
    actor: Actor;
    /** テナントの文脈つきのトランザクション(src/authz/middleware.ts が開く) */
    tx: TenantTx;
  };
};

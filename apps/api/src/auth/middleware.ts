import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env.ts";
import { getRequestContext } from "../request-context.ts";
import { readSession, type SessionConfig } from "./session.ts";

/** セッションを読むだけ(拒否はしない)。拒否するかどうかは authz/middleware.ts が決める。 */
export function authenticate(cfg: SessionConfig): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const session = await readSession(c, cfg);
    c.set("session", session);
    const ctx = getRequestContext();
    if (ctx && session) ctx.tenantId = session.tenantId;
    await next();
  };
}

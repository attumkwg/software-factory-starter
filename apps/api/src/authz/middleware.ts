import { and, eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { matchedRoutes } from "hono/route";
import type { RootDb } from "../db/client.ts";
import { users } from "../db/schema.ts";
import { withTenant } from "../db/tenant.ts";
import type { AppEnv } from "../env.ts";
import { forbidden, unauthorized } from "../errors.ts";
import type { Logger } from "../logger.ts";
import { can, PUBLIC, ruleFor, toOpenApiPath } from "./policy.ts";

class Rollback extends Error {}

/**
 * /api/* の全リクエストの前に1回だけ通る「認可の関所」。
 *
 * 1. 呼ばれた API の決まり(policy.ts の ROUTE_RULES)を引く。**無ければ拒否**。
 * 2. 公開の API でなければ、セッションから決まったテナントでトランザクションを開く(RLS が効く)。
 * 3. そのテナントの中で利用者とロールを引き、権限が無ければ拒否。
 * 4. 通ったら c.var.tx / c.var.actor をハンドラーに渡す。失敗したらまとめて取り消す。
 */
export function authorize(deps: { db: RootDb; logger: Logger }): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const method = c.req.method === "HEAD" ? "GET" : c.req.method;
    // Hono は登録順に最初のハンドラーで答えるので、最初に当たった /api/ のハンドラーを見る
    // (画面配信の「*」のような、/api/ の外のルートは API ではないので数えない)
    const handler = matchedRoutes(c).find((r) => r.method === method && r.path.startsWith("/api/"));
    // どの API にも当たらない → そのまま 404 に任せる
    if (!handler) return next();

    const path = toOpenApiPath(handler.path);
    const rule = ruleFor(method, path);
    if (rule === undefined) {
      deps.logger.error({ method, path }, "権限の決まりが無い API が呼ばれたので拒否しました");
      throw forbidden();
    }
    if (rule === PUBLIC) return next();

    const session = c.get("session");
    if (!session) throw unauthorized();

    try {
      await withTenant(deps.db, session.tenantId, async (tx) => {
        const [user] = await tx
          .select({ role: users.role })
          .from(users)
          .where(and(eq(users.id, session.userId), eq(users.tenantId, session.tenantId)));
        if (!user) throw unauthorized();
        if (!can(user.role, rule)) throw forbidden();

        c.set("actor", { userId: session.userId, tenantId: session.tenantId, role: user.role });
        c.set("tx", tx);
        await next();
        // ハンドラーが失敗していたら、書いた物を取り消す
        if (c.error) throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
  };
}

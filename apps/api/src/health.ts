import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { RootDb } from "./db/client.ts";
import type { Logger } from "./logger.ts";

export type Lifecycle = { shuttingDown: boolean };

/**
 * /healthz … 生きているか(プロセスが応答できるか)。ECS のコンテナのヘルスチェック用。
 * /readyz  … 受け付けてよいか(DB に届く・止める途中ではない)。ALB のヘルスチェック用。
 * どちらも API の契約(OpenAPI)には載せない。
 */
export function healthRoutes(deps: { db: RootDb; lifecycle: Lifecycle; logger: Logger }) {
  return new Hono()
    .get("/healthz", (c) => c.json({ status: "ok" }))
    .get("/readyz", async (c) => {
      if (deps.lifecycle.shuttingDown) return c.json({ status: "shutting_down" }, 503);
      try {
        await deps.db.execute(sql`select 1`);
        return c.json({ status: "ok" });
      } catch (err) {
        // ALB が10秒ごとに叩くので、DB が止まっている間は10秒に1行。障害の始まりと終わりが分かる
        deps.logger.warn({ err }, "/readyz: DB に届きません");
        return c.json({ status: "db_unreachable" }, 503);
      }
    });
}

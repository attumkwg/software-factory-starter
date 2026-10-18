import type { Context } from "hono";
import type { TenantTx } from "../db/client.ts";
import type { AppEnv } from "../env.ts";

/**
 * リポジトリに渡す「テナントの文脈」。RLS に頼るだけでなく、アプリ側でも tenant_id で絞る(層を重ねる)。
 * 作れるのは認可を通ったリクエストの中だけ。
 */
export type TenantScope = { tx: TenantTx; tenantId: string; userId: string };

export function scopeOf(c: Context<AppEnv>): TenantScope {
  const actor = c.get("actor");
  return { tx: c.get("tx"), tenantId: actor.tenantId, userId: actor.userId };
}

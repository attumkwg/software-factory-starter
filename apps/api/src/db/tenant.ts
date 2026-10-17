import { sql } from "drizzle-orm";
import type { RootDb, TenantTx } from "./client.ts";

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

/**
 * テナントの文脈つきでトランザクションを開く。中の読み書きは全部 RLS で自社の行に絞られる。
 *
 * `SET LOCAL app.tenant_id = ...` はパラメータを取れないので、同じ意味の
 * `set_config('app.tenant_id', $1, true)`(第3引数 true = このトランザクションの間だけ)を使う。
 * トランザクションが終われば消えるので、接続プールで次の利用者に漏れない。
 */
export async function withTenant<T>(
  db: RootDb,
  tenantId: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  if (!UUID.test(tenantId)) throw new Error("tenantId が UUID ではありません");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

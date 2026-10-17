import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.ts";

export { schema };

/**
 * 接続プール全体に対する DB。**テナントの文脈が無い**ので、触ってよいのは
 * src/db(withTenant)・src/auth(ログイン時の引き当て)・src/health だけ。
 * ルートとリポジトリからは使えない(Semgrep のルール tenant-scoped-db-only で止める)。
 */
export type RootDb = NodePgDatabase<typeof schema>;
/** テナントの文脈つきのトランザクション。ルートとリポジトリはこれだけを使う。 */
export type TenantTx = Parameters<Parameters<RootDb["transaction"]>[0]>[0];

export function createDb(databaseUrl: string): { db: RootDb; pool: pg.Pool } {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    // 1社の重いクエリで全体を止めない(security.md 4.3 の 6)
    options: "-c statement_timeout=5000",
  });
  const db = drizzle({ client: pool, schema, casing: "snake_case" });
  return { db, pool };
}

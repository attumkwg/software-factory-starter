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

/**
 * databaseUrl が無ければ node-postgres が PG* の環境変数を読む。
 * onIdleError: 使っていない接続が切れたとき(DB の再起動・Aurora の切り替え)に呼ぶ。
 * **これが無いとプロセスごと落ちる**(pg のプールは 'error' を投げ、聞く人がいないと Node が止まる)。
 */
export function createDb(
  databaseUrl: string | undefined,
  opts: { onIdleError?: (err: Error) => void } = {},
): { db: RootDb; pool: pg.Pool } {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    // DB に届かないとき、いつまでも待たない(待たずに 503 を返す)
    connectionTimeoutMillis: 5_000,
    // 1社の重いクエリで全体を止めない(security.md 4.3 の 6)。
    // 接続の時間帯は UTC に固定する(SQL の now()::date などが、DB の設定で変わらないように。ADR 0005)
    options: "-c statement_timeout=5000 -c TimeZone=UTC",
  });
  // 切れた接続はプールが捨てて、次は新しくつなぐ。ここでは記録だけ
  pool.on("error", (err) => opts.onIdleError?.(err));
  const db = drizzle({ client: pool, schema, casing: "snake_case" });
  return { db, pool };
}

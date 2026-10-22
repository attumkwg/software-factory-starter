import { AsyncResource } from "node:async_hooks";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { Logger } from "../logger.ts";
import { runOutsideRequestContext } from "../request-context.ts";
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
 * DB の時間切れ(接続ごとに、つないだときに渡す)。
 *
 * statementMs … 1つのクエリの上限。1社の重いクエリで全体を止めない(docs/security.md の T-6)。
 * idleInTransactionMs … トランザクションを開いたまま、DB に何も頼まずにいてよい上限。
 *   認可の関所(authz/middleware.ts)はリクエストごとにトランザクションを開くので、ハンドラーが
 *   DB 以外の所で止まると、接続と行のロックを握ったままになる。プールは10本しかないので、
 *   いくつか止まるだけで全部のリクエストが 503 になる。超えたら DB が接続を切り、ロックを放す。
 *   ふつうのリクエストではクエリの間はミリ秒なので、1つのクエリの上限の2倍(10秒)なら、
 *   正しく動いている物を切らない。
 */
export const DB_TIMEOUTS = { statementMs: 5_000, idleInTransactionMs: 10_000 } as const;
/** これより時間のかかったクエリをログに出す(DB 側の記録は infra の担当。ここはアプリから見た時間) */
export const SLOW_QUERY_MS = 500;
/** ログに残す SQL の長さの上限(値は $1 の形でしか入らない。長い IN (...) で行が膨らまないように) */
const SQL_MAX_CHARS = 500;

export type SlowQuery = { durationMs: number; sql: string; rows: number | null };

export type DbOptions = {
  /** 使っていない接続が切れた(DB の再起動・Aurora の切り替え) */
  onIdleError?: (err: Error) => void;
  /** 使用中の接続が DB 側から切られた(トランザクションを開いたまま止まっていた・再起動) */
  onActiveError?: (err: Error) => void;
  /** 時間のかかったクエリ。SQL は $1 の形のまま(値は入らない) */
  onSlowQuery?: (query: SlowQuery) => void;
  /** テスト用: 時間切れ・遅いクエリの線を短くする */
  timeouts?: { statementMs?: number; idleInTransactionMs?: number };
  slowQueryMs?: number;
};

/**
 * databaseUrl が無ければ node-postgres が PG* の環境変数を読む。
 * onIdleError / onActiveError: 接続が切れたときに呼ぶ。
 * **聞く人がいないとプロセスごと落ちる**(pg はプールにも接続にも 'error' を投げ、聞く人がいないと Node が止まる)。
 */
export function createDb(
  databaseUrl: string | undefined,
  opts: DbOptions = {},
): { db: RootDb; pool: pg.Pool } {
  const timeouts = { ...DB_TIMEOUTS, ...opts.timeouts };
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    // DB に届かないとき、いつまでも待たない(待たずに 503 を返す)
    connectionTimeoutMillis: 5_000,
    // 時間切れは上の DB_TIMEOUTS。
    // 接続の時間帯は UTC に固定する(SQL の now()::date などが、DB の設定で変わらないように。ADR 0005)
    options: [
      `-c statement_timeout=${timeouts.statementMs}`,
      `-c idle_in_transaction_session_timeout=${timeouts.idleInTransactionMs}`,
      "-c TimeZone=UTC",
    ].join(" "),
  });
  // 切れた接続はプールが捨てて、次は新しくつなぐ。ここでは記録だけ
  pool.on("error", (err) => opts.onIdleError?.(err));

  // 使用中の接続には、プールは 'error' を聞かない。DB が切ると(idle_in_transaction_session_timeout)
  // 聞く人がいないまま投げられてプロセスが止まるので、ここで受ける。次のクエリは失敗し(503)、
  // 返された接続はプールが捨てる。
  const active = new WeakSet<pg.PoolClient>();
  pool.on("acquire", (client) => active.add(client));
  pool.on("release", (_err, client) => active.delete(client));
  pool.on("connect", (client) => {
    // 切られると「DB からの知らせ」と「接続の終わり」の2回届くので、1つの接続につき1回だけ知らせる
    let reported = false;
    client.on("error", (err) => {
      if (reported || !active.has(client as pg.PoolClient)) return;
      reported = true;
      opts.onActiveError?.(err);
    });
    if (opts.onSlowQuery) timeQueries(client, opts.slowQueryMs ?? SLOW_QUERY_MS, opts.onSlowQuery);
  });

  const db = drizzle({ client: pool, schema, casing: "snake_case" });
  return { db, pool };
}

/** 接続が切れた・時間のかかったクエリを、ログに残す(index.ts と結合テストで同じ物を使う) */
export function dbLogging(logger: Logger): DbOptions {
  return {
    // 接続を作ったリクエストの文脈が残っているので、外して記録する
    onIdleError: (err) =>
      runOutsideRequestContext(() =>
        logger.warn({ err }, "使っていない DB の接続が切れました(DB の再起動など)"),
      ),
    // DB が使用中の接続を切った(トランザクションを開いたまま止まっていた・再起動)。そのリクエストは 503 になる
    onActiveError: (err) =>
      runOutsideRequestContext(() =>
        logger.warn(
          { err },
          "使用中の DB の接続が切れました(トランザクションの時間切れ・再起動など)",
        ),
      ),
    // SQL は $1 の形のまま(値は入らない)。requestId でアクセスログ(どの API か)とつなぐ
    onSlowQuery: ({ durationMs, sql, rows }) =>
      logger.warn({ durationMs, sql, rows }, "時間のかかったクエリがありました"),
  };
}

/**
 * この接続のクエリの時間を測り、線を超えた物を知らせる。Drizzle はプロミスの形
 * (トランザクションの中)と、プール経由のコールバックの形の両方で呼ぶので、両方を測る。
 * 知らせるのは、クエリを頼んだリクエストの文脈で(ログに requestId が入るように)。
 */
function timeQueries(client: pg.Client, slowMs: number, onSlow: (q: SlowQuery) => void): void {
  const original = client.query.bind(client) as (...args: unknown[]) => unknown;
  const timed = (...args: unknown[]): unknown => {
    const started = performance.now();
    const report = AsyncResource.bind((result: unknown) => {
      const durationMs = Math.round(performance.now() - started);
      if (durationMs < slowMs) return;
      const rows = (result as { rowCount?: unknown } | undefined)?.rowCount;
      onSlow({
        durationMs,
        sql: sqlText(args[0]).slice(0, SQL_MAX_CHARS),
        rows: typeof rows === "number" ? rows : null,
      });
    });
    const callback = args.at(-1);
    if (typeof callback === "function") {
      args[args.length - 1] = (err: unknown, result: unknown) => {
        report(result);
        callback(err, result);
      };
      return original(...args);
    }
    const out = original(...args);
    if (out instanceof Promise) out.then(report, () => report(undefined));
    return out;
  };
  client.query = timed as typeof client.query;
}

function sqlText(query: unknown): string {
  if (typeof query === "string") return query;
  const text = (query as { text?: unknown } | null)?.text;
  return typeof text === "string" ? text : "(SQL の文が無い)";
}

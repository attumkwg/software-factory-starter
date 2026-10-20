import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

/**
 * 移行を流す。接続は「表の持ち主」(MIGRATION_DATABASE_URL)で、アプリの接続ユーザーとは別。
 * 本番では ECS の1回きりのタスクとして、新しいイメージを出す前に流す(deploy.yml)。
 *
 * 1. drizzle の移行(drizzle/*.sql)。全部を1つのトランザクションで流す。
 * 2. トランザクションの外で流す移行(drizzle/concurrent/*.sql)。大きい表の索引を
 *    CREATE INDEX CONCURRENTLY で、書き込みを止めずに作る。流した物は drizzle.concurrent_migrations に残す。
 */
export async function runMigrations(
  databaseUrl: string | undefined,
  migrationsFolder?: string,
): Promise<void> {
  const folder =
    migrationsFolder ??
    process.env.MIGRATIONS_DIR ??
    fileURLToPath(new URL("../../drizzle", import.meta.url));
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: folder });
    await runConcurrentMigrations(pool, join(folder, "concurrent"));
  } finally {
    await pool.end();
  }
}

// 同時に2つの移行のタスクが流れても、索引を作るのは1つずつ(相手の作りかけを「失敗した物」と見て消さない)
const LOCK_KEY = 4_826_150_008;

/**
 * drizzle/concurrent/*.sql を名前の順に、まだ流していない物だけ流す。
 * - 書き方: drizzle の移行と同じく `--> statement-breakpoint` で区切る。1文ずつ自動で確定する。
 * - 何度流しても同じになる形(IF NOT EXISTS)で書く。途中で落ちたら、次の移行でもう一度流す。
 * - CONCURRENTLY が途中で落ちると「使えない索引」が残り、IF NOT EXISTS では作り直されないので、
 *   そのファイルに名前が出てくる「使えない索引」だけを先に消す。
 * - 索引を作る・消すだけに使う(表や列は drizzle の移行で)。drizzle の移行が全部終わった後に流れるので、
 *   drizzle の移行から、ここで作る索引に頼らない。
 */
async function runConcurrentMigrations(pool: pg.Pool, dir: string): Promise<void> {
  if (!existsSync(dir)) return;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(
      `create table if not exists drizzle.concurrent_migrations (
         name text primary key,
         applied_at timestamptz not null default now()
       )`,
    );
    const applied = new Set(
      (
        await client.query<{ name: string }>("select name from drizzle.concurrent_migrations")
      ).rows.map((r) => r.name),
    );
    for (const file of files) {
      if (applied.has(file)) continue;
      const text = readFileSync(join(dir, file), "utf8");
      await dropInvalidIndexesNamedIn(client, text);
      for (const statement of text.split("--> statement-breakpoint")) {
        if (statement.trim()) await client.query(statement);
      }
      await client.query("insert into drizzle.concurrent_migrations (name) values ($1)", [file]);
    }
  } finally {
    // 移行の SET(statement_timeout など)を持ち越さないよう、接続はプールに戻さず閉じる
    await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    client.release(true);
  }
}

async function dropInvalidIndexesNamedIn(client: pg.PoolClient, text: string): Promise<void> {
  const { rows } = await client.query<{ name: string; drop: string }>(
    `select c.relname as name, format('DROP INDEX CONCURRENTLY IF EXISTS %I.%I', n.nspname, c.relname) as drop
       from pg_index i
       join pg_class c on c.oid = i.indexrelid
       join pg_namespace n on n.oid = c.relnamespace
      where not i.indisvalid`,
  );
  for (const row of rows) {
    if (text.includes(`"${row.name}"`)) await client.query(row.drop);
  }
}

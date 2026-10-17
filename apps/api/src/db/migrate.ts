import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

/**
 * 移行を流す。接続は「表の持ち主」(MIGRATION_DATABASE_URL)で、アプリの接続ユーザーとは別。
 * 本番では ECS の1回きりのタスクとして、新しいイメージを出す前に流す(deploy.yml)。
 */
export async function runMigrations(databaseUrl: string, migrationsFolder?: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), {
      migrationsFolder:
        migrationsFolder ??
        process.env.MIGRATIONS_DIR ??
        fileURLToPath(new URL("../../drizzle", import.meta.url)),
    });
  } finally {
    await pool.end();
  }
}

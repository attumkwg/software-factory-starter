import { readFileSync } from "node:fs";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { Wait } from "testcontainers";
import type { TestProject } from "vitest/node";
import { runMigrations } from "../../src/db/migrate.ts";
import { TEMPLATE_DB } from "../helpers/isolated-db.ts";

declare module "vitest" {
  export interface ProvidedContext {
    /** 表の持ち主(移行・テスト用データの用意に使う) */
    ownerUrl: string;
    /** アプリの接続ユーザー(RLS がかかる) */
    appUrl: string;
    /** superuser(postgres の DB)。別の DB を作るときだけ使う(`createIsolatedDatabase`) */
    adminUrl: string;
  }
}

// 本番と同じ形: superuser で接続ユーザーを作る → 持ち主で移行 → アプリは持ち主ではないユーザーでつなぐ
export default async function setup(project: TestProject) {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("app")
    // 既定の待ち方(コンテナ内でポートを調べる)は古い Docker Desktop で止まることがあるので、
    // pg_isready のヘルスチェックだけで待つ
    .withWaitStrategy(Wait.forHealthCheck())
    .start();

  const su = new pg.Client({ connectionString: container.getConnectionUri() });
  await su.connect();
  await su.query(readFileSync(new URL("../../db/init/001-roles.sql", import.meta.url), "utf8"));
  await su.end();

  const base = `${container.getHost()}:${container.getPort()}/app`;
  const ownerUrl = `postgres://app_owner:app_owner@${base}`;
  await runMigrations(ownerUrl);

  // 写しは、テストがつなぐ前に作る(写す元にだれかがつないでいると作れない)
  const adminUrl = container.getConnectionUri().replace(/\/app$/, "/postgres");
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${TEMPLATE_DB} TEMPLATE app OWNER app_owner`);
  await admin.end();

  project.provide("ownerUrl", ownerUrl);
  project.provide("appUrl", `postgres://app:app@${base}`);
  project.provide("adminUrl", adminUrl);

  return async () => {
    await container.stop();
  };
}

import {
  currentVersion,
  type FeatureFlagDefinition,
  LEGAL_DOCUMENTS,
  type LegalVersion,
  type Role,
} from "@app/shared";
import { v7 as uuidv7 } from "uuid";
import { createApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config.ts";
import { createDb, type RootDb } from "../../src/db/client.ts";
import {
  consents,
  invitations,
  projects,
  supportGrants,
  tasks,
  tenants,
  users,
} from "../../src/db/schema.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { capacityOf } from "../../src/domains/legal/index.ts";
import { createLogger } from "../../src/logger.ts";

/** 1社ぶんのテスト用データ。テストは必ず2社以上で書く(自社と他社)。 */
export type TenantFixture = {
  tenantId: string;
  users: Record<Role, { id: string; email: string }>;
  projectId: string;
  taskId: string;
  /** サポートへの許可(管理者が出した。番号は分からない) */
  supportGrantId: string;
  /** 管理者が出した、まだ受けていない招待(メールは積まない) */
  invitationId: string;
};

/**
 * consented … 3人とも、いまの版の利用規約・プライバシーポリシーに同意済みにする(既定。docs/specs/0009-legal-consent.md)。
 * false なら誰も同意していない(同意の画面・関所のテスト用)。
 */
export async function createTenantFixture(
  ownerDb: RootDb,
  label = "t",
  opts: { consented?: boolean } = {},
): Promise<TenantFixture> {
  const tenantId = uuidv7();
  const suffix = tenantId.slice(-12);
  const mk = (role: Role) => ({ id: uuidv7(), email: `${role}-${suffix}@${label}.test`, role });
  const admin = mk("admin");
  const member = mk("member");
  const viewer = mk("viewer");
  const projectId = uuidv7();
  const taskId = uuidv7();
  const supportGrantId = uuidv7();
  const invitationId = uuidv7();

  await withTenant(ownerDb, tenantId, async (tx) => {
    await tx.insert(tenants).values({ tenantId, name: `${label}-${suffix}` });
    await tx
      .insert(users)
      .values(
        [admin, member, viewer].map((u) => ({ ...u, tenantId, name: `${u.role} ${suffix}` })),
      );
    await tx
      .insert(projects)
      .values({ id: projectId, tenantId, name: "最初の計画", createdBy: admin.id });
    await tx.insert(tasks).values({ id: taskId, tenantId, projectId, title: "最初のタスク" });
    if (opts.consented ?? true) {
      const now = new Date();
      const rows = [admin, member, viewer].flatMap((u) =>
        LEGAL_DOCUMENTS.flatMap((document) => {
          const version = currentVersion(document, now)?.version;
          if (version === undefined) return [];
          const capacity = capacityOf(u.role, document);
          return [{ tenantId, userId: u.id, document, version, capacity, source: "acceptance" }];
        }),
      );
      if (rows.length > 0) await tx.insert(consents).values(rows);
    }
    await tx.insert(supportGrants).values({
      id: supportGrantId,
      tenantId,
      grantedBy: admin.id,
      codeHash: `fixture-${supportGrantId}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    await tx.insert(invitations).values({
      id: invitationId,
      tenantId,
      email: `invited-${suffix}@${label}.test`,
      role: "member",
      invitedBy: admin.id,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
  });

  return {
    tenantId,
    users: {
      admin: { id: admin.id, email: admin.email },
      member: { id: member.id, email: member.email },
      viewer: { id: viewer.id, email: viewer.email },
    },
    projectId,
    taskId,
    supportGrantId,
    invitationId,
  };
}

/** アプリの接続ユーザー(RLS がかかる)で組み立てた、本物と同じアプリ。env で設定を足せる */
export function createTestApp(
  appUrl: string,
  env: Record<string, string> = {},
  opts: {
    legalVersions?: readonly LegalVersion[];
    featureFlags?: readonly FeatureFlagDefinition[];
  } = {},
) {
  const { db, pool } = createDb(appUrl);
  const config = loadConfig({
    APP_ENV: "test",
    DATABASE_URL: appUrl,
    SESSION_SECRET: "test-only-".padEnd(40, "x"),
    ...env,
  });
  const lifecycle = { shuttingDown: false };
  const app = createApp({
    config,
    db,
    logger: createLogger({ level: "silent" }),
    lifecycle,
    ...(opts.legalVersions ? { legalVersions: opts.legalVersions } : {}),
    ...(opts.featureFlags ? { featureFlags: opts.featureFlags } : {}),
  });
  return { app, pool, lifecycle };
}

type TestApp = ReturnType<typeof createTestApp>["app"];

/** 開発用ログインで Cookie をもらう。 */
export async function login(app: TestApp, email: string): Promise<string> {
  const res = await app.request("/api/auth/dev-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("no cookie");
  return setCookie.split(";")[0] ?? "";
}

export function call(
  app: TestApp,
  method: string,
  path: string,
  opts: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  // ブラウザと同じく Origin を付ける(付けないと CSRF の守りで 403 になる)
  const headers: Record<string, string> = { origin: "http://localhost", ...opts.headers };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

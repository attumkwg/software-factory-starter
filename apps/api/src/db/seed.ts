import type { Role } from "@app/shared";
import { eq } from "drizzle-orm";
import { createDb } from "./client.ts";
import { projects, tasks, tenants, users } from "./schema.ts";
import { withTenant } from "./tenant.ts";

// 開発・プレビュー・E2E 用の種データ。**必ず2社**作る(自社と他社で漏れを確かめるため)。
// 本番の個人データは使わない。ID を固定して、E2E と手元で同じデータになるようにしている。

type SeedTenant = {
  tenantId: string;
  name: string;
  /** 2社で時間帯を変えておく(時刻の表示が組織ごとになっているかを確かめるため) */
  timeZone: string;
  users: { id: string; email: string; name: string; role: Role }[];
  projects: { id: string; name: string; tasks: string[] }[];
};

/** 運営の組織(手元・プレビューの SUPPORT_TENANT_ID と同じ) */
export const SUPPORT_SEED_TENANT_ID = "0199a000-0000-7000-8000-00000000c001";

export const SEED: SeedTenant[] = [
  {
    tenantId: "0199a000-0000-7000-8000-00000000a001",
    name: "Acme 株式会社",
    timeZone: "Asia/Tokyo",
    users: [
      {
        id: "0199a000-0000-7000-8000-0000000a0001",
        email: "admin@acme.test",
        name: "Acme 管理者",
        role: "admin",
      },
      {
        id: "0199a000-0000-7000-8000-0000000a0002",
        email: "member@acme.test",
        name: "Acme メンバー",
        role: "member",
      },
      {
        id: "0199a000-0000-7000-8000-0000000a0003",
        email: "viewer@acme.test",
        name: "Acme 閲覧者",
        role: "viewer",
      },
    ],
    projects: [
      {
        id: "0199a000-0000-7000-8000-00000000a101",
        name: "Acme の立ち上げ",
        tasks: ["要件を書く", "画面を作る"],
      },
    ],
  },
  {
    tenantId: "0199a000-0000-7000-8000-00000000b001",
    name: "Globex 合同会社",
    timeZone: "America/Los_Angeles",
    users: [
      {
        id: "0199a000-0000-7000-8000-0000000b0001",
        email: "admin@globex.test",
        name: "Globex 管理者",
        role: "admin",
      },
    ],
    projects: [
      {
        id: "0199a000-0000-7000-8000-00000000b101",
        name: "Globex の秘密の計画",
        tasks: ["他社に見えてはいけない"],
      },
    ],
  },
  {
    // 運営の組織(社員がサポート番号で代理ログインする。SUPPORT_TENANT_ID。docs/specs/0004-support-access.md)
    tenantId: SUPPORT_SEED_TENANT_ID,
    name: "運営(サポート)",
    timeZone: "Asia/Tokyo",
    users: [
      {
        id: "0199a000-0000-7000-8000-0000000c0001",
        email: "support@ops.test",
        name: "サポート担当",
        role: "member",
      },
    ],
    projects: [],
  },
];

/** 何度流しても同じ結果になる(すでにあれば飛ばす)。接続は表の持ち主でもよい(FORCE RLS なので文脈は要る)。 */
export async function seed(databaseUrl: string | undefined): Promise<void> {
  const { db, pool } = createDb(databaseUrl);
  try {
    for (const t of SEED) {
      await withTenant(db, t.tenantId, async (tx) => {
        await tx
          .insert(tenants)
          .values({ tenantId: t.tenantId, name: t.name, timeZone: t.timeZone })
          .onConflictDoNothing();
        await tx
          .insert(users)
          .values(t.users.map((u) => ({ ...u, tenantId: t.tenantId })))
          .onConflictDoNothing();
        const owner = t.users[0];
        if (!owner) return;
        for (const p of t.projects) {
          await tx
            .insert(projects)
            .values({ id: p.id, tenantId: t.tenantId, name: p.name, createdBy: owner.id })
            .onConflictDoNothing();
          const existing = await tx.$count(tasks, eq(tasks.projectId, p.id));
          if (existing > 0) continue;
          await tx
            .insert(tasks)
            .values(p.tasks.map((title) => ({ tenantId: t.tenantId, projectId: p.id, title })));
        }
      });
    }
  } finally {
    await pool.end();
  }
}

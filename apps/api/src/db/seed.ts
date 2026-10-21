import { currentVersion, LEGAL_DOCUMENTS, type Role } from "@app/shared";
import { eq } from "drizzle-orm";
import { capacityOf } from "../domains/legal/index.ts";
import { createDb } from "./client.ts";
import { consents, projects, tasks, tenants, users } from "./schema.ts";
import { withTenant } from "./tenant.ts";

// 開発・プレビュー・E2E 用の種データ。**必ず2社**作る(自社と他社で漏れを確かめるため)。
// 本番の個人データは使わない。ID を固定して、E2E と手元で同じデータになるようにしている。

type SeedTenant = {
  tenantId: string;
  name: string;
  /** 2社で時間帯を変えておく(時刻の表示が組織ごとになっているかを確かめるため) */
  timeZone: string;
  /** 二段階認証を必須にするか(運営の組織だけ true。docs/specs/0006-account-security.md の U-7) */
  mfaRequired?: boolean;
  /**
   * notConsented … 利用規約・プライバシーポリシーに同意していない人(docs/specs/0008-legal-consent.md)。
   * ほかの人は、種データを入れた時のいまの版に同意済みにする(でないと、手元と E2E の全員が最初に同意の画面へ回される)
   */
  users: { id: string; email: string; name: string; role: Role; notConsented?: boolean }[];
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
      {
        // 規約にまだ同意していない人(E2E の「同意の画面」で使う。同意すると、次からはふつうに使える)
        id: "0199a000-0000-7000-8000-0000000a0004",
        email: "newcomer@acme.test",
        name: "Acme 新しい人",
        role: "member",
        notConsented: true,
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
    // 運営の組織は最初から二段階認証を必須にする(切れない)。開発用ログインでは関所が回さないので使える
    mfaRequired: true,
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

/** 種データの人の同意(いまの版。source は同意の画面と同じ扱い) */
function seedConsents(t: SeedTenant) {
  const now = new Date();
  return t.users
    .filter((u) => !u.notConsented)
    .flatMap((u) =>
      LEGAL_DOCUMENTS.flatMap((document) => {
        const version = currentVersion(document, now)?.version;
        if (version === undefined) return [];
        const capacity = capacityOf(u.role, document);
        return [
          { tenantId: t.tenantId, userId: u.id, document, version, capacity, source: "acceptance" },
        ];
      }),
    );
}

/** 何度流しても同じ結果になる(すでにあれば飛ばす)。接続は表の持ち主でもよい(FORCE RLS なので文脈は要る)。 */
export async function seed(databaseUrl: string | undefined): Promise<void> {
  const { db, pool } = createDb(databaseUrl);
  try {
    for (const t of SEED) {
      await withTenant(db, t.tenantId, async (tx) => {
        await tx
          .insert(tenants)
          .values({
            tenantId: t.tenantId,
            name: t.name,
            timeZone: t.timeZone,
            mfaRequired: t.mfaRequired ?? false,
          })
          .onConflictDoNothing();
        // 運営の組織は、移行 0009 より前に作った手元の DB でも必須にそろえる(必須を足すだけ。切りはしない)
        if (t.mfaRequired) {
          await tx
            .update(tenants)
            .set({ mfaRequired: true })
            .where(eq(tenants.tenantId, t.tenantId));
        }
        await tx
          .insert(users)
          .values(t.users.map(({ notConsented: _, ...u }) => ({ ...u, tenantId: t.tenantId })))
          .onConflictDoNothing();
        await tx.insert(consents).values(seedConsents(t)).onConflictDoNothing();
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

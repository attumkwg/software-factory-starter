import { currentVersion, LEGAL_DOCUMENTS, type Role } from "@app/shared";
import { eq } from "drizzle-orm";
import { capacityOf } from "../domains/legal/index.ts";
import { createDb } from "./client.ts";
import {
  consents,
  domains,
  featureFlags,
  projects,
  ssoConnections,
  tasks,
  tenants,
  users,
} from "./schema.ts";
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
   * notConsented … 利用規約・プライバシーポリシーに同意していない人(docs/specs/0009-legal-consent.md)。
   * ほかの人は、種データを入れた時のいまの版に同意済みにする(でないと、手元と E2E の全員が最初に同意の画面へ回される)
   */
  users: { id: string; email: string; name: string; role: Role; notConsented?: boolean }[];
  projects: { id: string; name: string; tasks: string[] }[];
  /**
   * 会社のアカウント(SSO)を試す組織(docs/specs/0056-sso-scim-ip-audit-export.md)。確かめ済みのドメイン・機能 sso・つないだ IdP。
   * IdP は偽物の Cognito が起動時に同じ名前でつなぐ(docker-compose.cognito.yml の FAKE_COGNITO_SAML_PROVIDERS)
   */
  sso?: { domain: string; providerName: string };
};

type SeedTx = Parameters<Parameters<typeof withTenant>[2]>[0];

/** 種データの SSO の組織の IdP の名前(偽物の Cognito の FAKE_COGNITO_SAML_PROVIDERS と同じ) */
export const SEED_SSO_PROVIDER = "org-seed-initech";

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
    // 会社のアカウント(SSO)を試す組織。Cognito の手元の構成(docker-compose.cognito.yml)と E2E の cognito-sso.spec.ts で使う。
    // 開発用ログインのときは、SSO の欄が出るだけ(IdP の入口が無いので、ログインはパスワードの段のまま)
    tenantId: "0199a000-0000-7000-8000-00000000d001",
    name: "Initech 株式会社",
    timeZone: "Asia/Tokyo",
    users: [
      {
        id: "0199a000-0000-7000-8000-0000000d0001",
        email: "admin@initech.test",
        name: "Initech 管理者",
        role: "admin",
      },
      {
        id: "0199a000-0000-7000-8000-0000000d0002",
        email: "member@initech.test",
        name: "Initech メンバー",
        role: "member",
      },
    ],
    projects: [],
    sso: { domain: "initech.test", providerName: SEED_SSO_PROVIDER },
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

/** SSO の組織: 確かめ済みのドメイン・機能 sso(運営が組織ごとに入れた形)・つないだ IdP(必須にはしない) */
async function seedSso(
  tx: SeedTx,
  tenantId: string,
  adminId: string,
  sso: { domain: string; providerName: string },
) {
  await tx
    .insert(domains)
    .values({
      id: tenantId.replace(/d001$/, "d201"),
      tenantId,
      domain: sso.domain,
      verifyToken: "seed",
      verifiedAt: new Date(),
      createdBy: adminId,
    })
    .onConflictDoNothing();
  await tx
    .insert(featureFlags)
    .values({ id: tenantId.replace(/d001$/, "d202"), tenantId, flag: "sso" })
    .onConflictDoNothing();
  await tx
    .insert(ssoConnections)
    .values({ id: tenantId.replace(/d001$/, "d203"), tenantId, providerName: sso.providerName })
    .onConflictDoNothing();
}

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
        if (t.sso) await seedSso(tx, t.tenantId, owner.id, t.sso);
        await seedProjects(tx, t, owner.id);
      });
    }
  } finally {
    await pool.end();
  }
}

/** プロジェクトと最初のタスク(タスクがもうあるプロジェクトには足さない) */
async function seedProjects(tx: SeedTx, t: SeedTenant, ownerId: string) {
  for (const p of t.projects) {
    await tx
      .insert(projects)
      .values({ id: p.id, tenantId: t.tenantId, name: p.name, createdBy: ownerId })
      .onConflictDoNothing();
    const existing = await tx.$count(tasks, eq(tasks.projectId, p.id));
    if (existing > 0) continue;
    await tx
      .insert(tasks)
      .values(p.tasks.map((title) => ({ tenantId: t.tenantId, projectId: p.id, title })));
  }
}

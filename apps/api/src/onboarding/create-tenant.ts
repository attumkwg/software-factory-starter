import {
  DateOnlySchema,
  DEFAULT_TIME_ZONE,
  PLANS,
  PRICE_LISTS,
  TimeZoneSchema,
  toLocalDate,
} from "@app/shared";
import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { MANUAL_AUDIT_ACTIONS, recordAudit } from "../audit/index.ts";
import type { RootDb, TenantTx } from "../db/client.ts";
import { tenants, users } from "../db/schema.ts";
import { withTenant } from "../db/tenant.ts";
import { enqueue } from "../outbox/index.ts";
import { type Defs, insertPlan, planChange } from "../plans/index.ts";

// 申し込みを受けた組織を作る(運営が、申込書を確かめてから。docs/specs/0026-tenant-provisioning.md・ADR 0039)。
// 手順は docs/runbooks/tenant-provisioning.md。API は作らない(組織を増やすのは契約の後で、画面や API の鍵1本でできないようにする)。
//
//   node dist/cli.js create-tenant applications/<申込番号>.json                                   … 試し(作って、最後に取り消す)
//   node dist/cli.js create-tenant applications/<申込番号>.json --execute --confirm-name <組織の名前> … 本当に作る
//
// 申し込みの JSON は非公開の S3(申し込みの置き場)に置き、引数はキーだけ(application-source.ts)。
//
// 接続は表の持ち主(移行と同じ)。FORCE RLS なので、新しい組織の文脈を付けて、その組織の行だけを書く。

/**
 * 申し込みの形(申込書・事前登録の項目をそのまま渡せるように、知らない項目は読み飛ばして名前だけ返す)。
 * メールは小文字にそろえる(ログインの結びつけが小文字で探すため。drizzle/0005_login_link.sql)。
 */
export const TenantApplicationSchema = z.looseObject({
  name: z.string().trim().min(1).max(100),
  timeZone: TimeZoneSchema.default(DEFAULT_TIME_ZONE),
  mfaRequired: z.boolean().default(false),
  admin: z.object({
    email: z
      .email()
      .max(254)
      .transform((e) => e.toLowerCase()),
    name: z.string().trim().min(1).max(100),
  }),
  // 契約のプラン(docs/specs/0047-plans.md)。申込書の「プラン」「人数」の欄。無ければプランを入れない(後から plan のコマンドで)
  plan: z.string().min(1).max(32).optional(),
  seats: z.number().int().positive().optional(),
  priceList: z.string().min(1).max(32).optional(),
  priceLockedUntil: DateOnlySchema.optional(),
});

export type TenantApplication = z.infer<typeof TenantApplicationSchema>;

/** 申し込みの JSON を読む。読めなければ、どの項目が違うかだけを言って投げる(値は出さない) */
export function parseTenantApplication(json: string): {
  application: TenantApplication;
  ignoredKeys: string[];
} {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("申し込みが JSON として読めません(置き場のファイルを確かめてください)");
  }
  const parsed = TenantApplicationSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "(全体)"))];
    throw new Error(`申し込みの項目が正しくありません: ${fields.join(", ")}`);
  }
  const known = new Set([
    "name",
    "timeZone",
    "mfaRequired",
    "admin",
    "plan",
    "seats",
    "priceList",
    "priceLockedUntil",
  ]);
  const ignoredKeys = Object.keys(raw as object).filter((k) => !known.has(k));
  return { application: parsed.data, ignoredKeys };
}

export type CreatedTenant = {
  tenantId: string;
  adminUserId: string;
  timeZone: string;
  mfaRequired: boolean;
  /**
   * 最初の管理者のメールが、ほかの組織に所属している数(1人が複数の組織に入れる。ADR 0066)。
   * 1以上なら、同じ申し込みを2回流していないかを2人で確かめる(設計書 0055 の U-5)
   */
  adminOtherMemberships: number;
};

class DryRun extends Error {}

/**
 * 1つのトランザクションで、組織と最初の管理者(users の行。Cognito の sub は初めてのログインで結びつく)を作り、
 * その組織の監査ログに「運営が作った」を残す。運営の組織にも同じ記録を残す(名前・メールは残さない)。
 *
 * execute が false(試し)なら、同じことを流してから取り消す。本番で落ちる理由は、試しでも同じに落ちる(何も残らない)。
 * 最初の管理者がほかの組織にも所属していれば adminOtherMemberships に数を出す(止めない)。
 */
export async function createTenant(
  db: RootDb,
  application: TenantApplication,
  opts: { execute: boolean; confirmName?: string; supportTenantId: string | null; defs?: Defs },
): Promise<CreatedTenant> {
  const defs = opts.defs ?? { plans: PLANS, priceLists: PRICE_LISTS };
  if (opts.execute && opts.confirmName !== application.name) {
    throw new Error("--confirm-name が申し込みの組織の名前と違うので、何も作っていません");
  }
  const created: CreatedTenant = {
    tenantId: uuidv7(),
    adminUserId: uuidv7(),
    timeZone: application.timeZone,
    mfaRequired: application.mfaRequired,
    adminOtherMemberships: await countByEmail(db, application.admin.email),
  };
  const { tenantId, adminUserId } = created;
  try {
    // 運営の組織への記録も同じトランザクションで(片方だけ残らないように)。文脈は途中で付け替える
    await withTenant(db, tenantId, async (tx) => {
      await tx.insert(tenants).values({
        tenantId,
        name: application.name,
        timeZone: application.timeZone,
        mfaRequired: application.mfaRequired,
      });
      await tx.insert(users).values({
        id: adminUserId,
        tenantId,
        email: application.admin.email,
        name: application.admin.name,
        role: "admin",
      });
      // 最初の管理者への案内のメール(登録の仕方)。送るのは API のアウトボックスの送り出し(docs/specs/0027-invitations.md)
      await enqueue({ tx, tenantId, userId: adminUserId }, "organizations.tenant_opened", {
        userId: adminUserId,
      });
      const entry = {
        actor: { kind: "system" as const, id: null },
        action: MANUAL_AUDIT_ACTIONS.tenantCreate,
        target: { type: "organization", id: tenantId },
        outcome: "allowed" as const,
        details: { adminUserId },
      };
      await recordAudit(tx, { tenantId, ...entry });
      if (application.plan) {
        // 申込書のプランと人数(docs/specs/0047-plans.md)。価格表を省けば、その日の版
        const today = toLocalDate(new Date(), application.timeZone);
        const line = planChange(
          null,
          {
            plan: application.plan,
            priceList: application.priceList,
            seats: application.seats ?? null,
            priceLockedUntil: application.priceLockedUntil ?? null,
          },
          defs,
          today,
        );
        await insertPlan(tx, tenantId, line);
      }
      if (opts.supportTenantId && opts.supportTenantId !== tenantId) {
        await withSupportContext(tx, opts.supportTenantId, () =>
          recordAudit(tx, { tenantId: opts.supportTenantId as string, ...entry }),
        );
      }
      if (!opts.execute) throw new DryRun();
    });
  } catch (e) {
    if (e instanceof DryRun) return created;
    throw toFriendlyError(e);
  }
  return created;
}

/** 同じトランザクションの中で、文脈を運営の組織に付け替えて fn を流し、戻す */
async function withSupportContext(tx: TenantTx, supportTenantId: string, fn: () => Promise<void>) {
  const current = await tx.execute<{ t: string }>(
    sql`select current_setting('app.tenant_id') as t`,
  );
  await tx.execute(sql`select set_config('app.tenant_id', ${supportTenantId}, true)`);
  await fn();
  await tx.execute(sql`select set_config('app.tenant_id', ${current.rows[0]?.t ?? ""}, true)`);
}

/** 失敗はそのまま投げる(全体の一意は無くなったので、メールの重なりでは落ちない。ADR 0066) */
function toFriendlyError(e: unknown): unknown {
  return e;
}

/** そのメールの所属の数(全部の組織で。DB の関数。表の持ち主で流す) */
async function countByEmail(db: RootDb, email: string): Promise<number> {
  const r = await db.execute<{ n: number }>(
    sql`select auth_count_memberships_by_email(${email}) as n`,
  );
  return r.rows[0]?.n ?? 0;
}

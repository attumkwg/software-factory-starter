import { sql } from "drizzle-orm";
import { MANUAL_AUDIT_ACTIONS } from "../audit/actions.ts";
import { recordAudit } from "../audit/record.ts";
import type { RootDb } from "../db/client.ts";
import { withTenant } from "../db/tenant.ts";
import type { ObjectStore } from "../storage/index.ts";

// 解約した組織のデータを消す(運営が、契約を確かめてから。docs/specs/0005-offboarding.md・ADR 0015)。
// 手順は docs/runbooks/offboarding.md。API は作らない(戻せない操作を、画面や API の鍵1本でできないようにする)。
//
//   node dist/cli.js delete-tenant <組織の ID>                                   … 試し(数えるだけ)
//   node dist/cli.js delete-tenant <組織の ID> --execute --confirm-name <組織の名前> … 本当に消す
//
// 接続は表の持ち主(移行と同じ)。FORCE RLS なので、組織の文脈を付けて、その組織の行だけを消す。

/**
 * tenant_id を持つ表を、消す順番(子から親)に。**表を足したら、ここにも足す**
 * (無ければ結合テスト offboarding.int.test.ts が落ちる)。
 */
export const TENANT_TABLES = [
  // 要配慮個人情報(ADR 0029)。データ鍵を最初に消す = 暗号による消去(要配慮の表を足したら、この前に)
  "sensitive.tenant_keys",
  // 公開の LP の事前登録(運営の組織の持ち物。運営の組織は解約しないが、表の網羅のため)
  "growth.pre_registrations",
  "growth.lp_daily_counts",
  "legal.notices",
  "legal.consents",
  "organizations.invitations",
  "organizations.sso_connections",
  "organizations.domains",
  "organizations.ip_allowlist",
  "organizations.scim_tokens",
  "organizations.email_changes",
  "organizations.support_sessions",
  "organizations.support_grants",
  "platform.tenant_plans",
  "platform.pmf_survey_counts",
  "platform.pmf_survey_asked",
  "platform.feature_usage",
  "platform.feature_flags",
  // 写真・ファイルの目録(中身の置き場は DB より先に消す。docs/designs/0072-file-storage.md の 2)。
  // 行を消すと引き金が送信待ちに積むが、送信待ちも後ろで消える
  "files.files",
  "tasks.tasks",
  "projects.projects",
  "platform.outbox",
  "platform.audit_events",
  "organizations.users",
  "organizations.tenants",
] as const;

export type DeletionPlan = {
  tenantId: string;
  tenantName: string;
  counts: Record<string, number>;
  /** 認証の製品(Cognito)の利用者。DB より先に消す(手順書の 3)。ほかの組織にも所属している人は入れない */
  cognitoSubs: string[];
  /** ほかの組織にも所属しているので、Cognito からは消さない人の数(docs/specs/0055-multi-org-membership.md) */
  cognitoSubsInOtherOrgs: number;
};

const table = (name: string) => {
  const [schema, rel] = name.split(".");
  return sql`${sql.identifier(schema as string)}.${sql.identifier(rel as string)}`;
};

/** 何をいくつ消すかを数える(消さない)。組織が無ければ null */
export async function planTenantDeletion(
  db: RootDb,
  tenantId: string,
): Promise<DeletionPlan | null> {
  return withTenant(db, tenantId, async (tx) => {
    const tenant = await tx.execute<{ name: string }>(
      sql`select name from organizations.tenants where tenant_id = ${tenantId}`,
    );
    const name = tenant.rows[0]?.name;
    if (name === undefined) return null;
    const counts: Record<string, number> = {};
    for (const t of TENANT_TABLES) {
      const r = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from ${table(t)} where tenant_id = ${tenantId}`,
      );
      counts[t] = r.rows[0]?.n ?? 0;
    }
    // ほかの組織にも所属している人(同じ sub の行がほかにもある)は、Cognito から消さない(所属だけを消す)
    const subs = await tx.execute<{ external_id: string; memberships: number }>(
      sql`select external_id, auth_count_memberships(external_id) as memberships
            from organizations.users where tenant_id = ${tenantId} and external_id is not null`,
    );
    const cognitoSubs = subs.rows.filter((r) => r.memberships <= 1).map((r) => r.external_id);
    return {
      tenantId,
      tenantName: name,
      counts,
      cognitoSubs,
      cognitoSubsInOtherOrgs: subs.rows.length - cognitoSubs.length,
    };
  });
}

/**
 * 1つのトランザクションで、その組織の全部の表の行を消す(途中で失敗したら何も消えない)。
 * 監査ログも消すので(app.audit_purge)、運営の組織の監査ログに「いつ・どの ID を・何件」を残す(名前は残さない)。
 */
export async function deleteTenant(
  db: RootDb,
  tenantId: string,
  opts: {
    confirmName: string;
    supportTenantId: string | null;
    /** 写真・ファイルの置き場(docs/designs/0072-file-storage.md)。無い環境でファイルの行があれば、何も消さずに止める */
    files?: ObjectStore | null;
  },
): Promise<DeletionPlan> {
  if (opts.supportTenantId && tenantId === opts.supportTenantId) {
    throw new Error("運営の組織は消せません");
  }
  const plan = await planTenantDeletion(db, tenantId);
  if (!plan) throw new Error(`組織がありません: ${tenantId}`);
  if (plan.tenantName !== opts.confirmName) {
    throw new Error("--confirm-name が組織の名前と違うので、何も消していません");
  }
  // 置き場の中身を、DB より先に前の版まで消す(Cognito と同じ「外を先に」。DB の行が残っていればやり直せる)
  if (opts.files) {
    await opts.files.purgeTenant(tenantId, { dryRun: false });
  } else if ((plan.counts["files.files"] ?? 0) > 0) {
    throw new Error("写真・ファイルの置き場の設定(FILES_*)が無いので、何も消していません");
  }
  await withTenant(db, tenantId, async (tx) => {
    // 監査ログを消してよい手順(移行 0006 のトリガーが、これの無い DELETE を止める)
    await tx.execute(sql`select set_config('app.audit_purge', 'on', true)`);
    for (const t of TENANT_TABLES) {
      await tx.execute(sql`delete from ${table(t)} where tenant_id = ${tenantId}`);
    }
  });
  if (opts.supportTenantId) {
    await withTenant(db, opts.supportTenantId, (tx) =>
      recordAudit(tx, {
        tenantId: opts.supportTenantId as string,
        actor: { kind: "system", id: null },
        action: MANUAL_AUDIT_ACTIONS.tenantDelete,
        target: { type: "organization", id: tenantId },
        outcome: "allowed",
        details: { counts: plan.counts },
      }),
    );
  }
  return plan;
}

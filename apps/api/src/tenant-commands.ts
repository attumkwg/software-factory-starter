import { createDb } from "./db/client.ts";
import { deleteTenant, planTenantDeletion } from "./offboarding/delete-tenant.ts";
import { applicationSourceFor } from "./onboarding/application-source.ts";
import { createTenant, parseTenantApplication } from "./onboarding/create-tenant.ts";
import { planPersonData } from "./person-data/plan-person-data.ts";

// 組織を作る・1人分を数える・組織を消す、の運営のコマンド(cli.ts から呼ぶ。手順は docs/runbooks/)。
// 本番の DB に書く(読む)ので人が打つ。接続は移行と同じ表の持ち主。

const appEnv = process.env.APP_ENV ?? "local";
// 未指定なら node-postgres が PGHOST / PGUSER / PGPASSWORD / PGDATABASE を読む(本番の移行タスク)
const migrationUrl = process.env.MIGRATION_DATABASE_URL;

/**
 * 申し込みを受けた組織を作る。--execute が無ければ、流してから取り消す(試し)。結果は JSON 1行(名前・メールは出さない)。
 * 申し込みは置き場(S3)から読む。引数はキーだけ(CloudTrail に名前・メールを残さない)
 */
export async function createTenantCommand(args: string[]) {
  const [key, ...flags] = args;
  if (!key) throw new Error("置き場のキーがありません: create-tenant applications/<申込番号>.json");
  const source = applicationSourceFor({ appEnv, bucket: process.env.APPLICATIONS_BUCKET });
  const { application, ignoredKeys } = parseTenantApplication(await source.read(key));
  const execute = flags.includes("--execute");
  const nameAt = flags.indexOf("--confirm-name");
  const confirmName = nameAt >= 0 ? flags[nameAt + 1] : undefined;
  if (execute && !confirmName)
    throw new Error("--execute には --confirm-name <組織の名前> が要ります");
  const { db, pool } = createDb(migrationUrl);
  try {
    const created = await createTenant(db, application, {
      execute,
      confirmName,
      supportTenantId: process.env.SUPPORT_TENANT_ID ?? null,
    });
    const line = execute
      ? { mode: "created", ...created, ignoredKeys }
      : { mode: "plan", timeZone: created.timeZone, mfaRequired: created.mfaRequired, ignoredKeys };
    process.stdout.write(`${JSON.stringify(line)}\n`);
    if (!execute) {
      process.stdout.write(
        "まだ作っていません(流してから取り消しました)。中身を確かめて --execute --confirm-name <組織の名前> を付けて流してください\n",
      );
    }
  } finally {
    await pool.end();
  }
}

/** 利用者1人分の開示・削除の試し(数えるだけ・何も変えない)。結果は JSON 1行(値は出さない) */
export async function personDataCommand(args: string[]) {
  const [tenantId, userId] = args;
  const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
  if (!tenantId || !userId || !uuid.test(tenantId) || !uuid.test(userId)) {
    throw new Error(
      "使い方: person-data <組織の ID> <利用者の ID>(どちらも UUID。名前・メールは渡さない)",
    );
  }
  const { db, pool } = createDb(migrationUrl);
  try {
    const plan = await planPersonData(db, tenantId, userId);
    process.stdout.write(`${JSON.stringify({ mode: "plan", ...plan })}\n`);
    if (!plan.found)
      process.stdout.write("その組織にその利用者はいません(ID を確かめてください)\n");
  } finally {
    await pool.end();
  }
}

/** 解約した組織を消す。--execute が無ければ数えるだけ。結果は JSON 1行(組織の名前は出さない) */
export async function deleteTenantCommand(args: string[]) {
  const [tenantId, ...flags] = args;
  if (!tenantId) throw new Error("組織の ID がありません: delete-tenant <組織の ID>");
  const execute = flags.includes("--execute");
  const nameAt = flags.indexOf("--confirm-name");
  const confirmName = nameAt >= 0 ? flags[nameAt + 1] : undefined;
  const { db, pool } = createDb(migrationUrl);
  try {
    if (!execute) {
      const plan = await planTenantDeletion(db, tenantId);
      if (!plan) throw new Error(`組織がありません: ${tenantId}`);
      const line = {
        mode: "plan",
        tenantId,
        counts: plan.counts,
        cognitoSubs: plan.cognitoSubs,
        cognitoSubsInOtherOrgs: plan.cognitoSubsInOtherOrgs,
      };
      process.stdout.write(`${JSON.stringify(line)}\n`);
      process.stdout.write(
        "まだ消していません。組織の名前を確かめて --execute --confirm-name <名前> を付けて流してください\n",
      );
      return;
    }
    if (!confirmName) throw new Error("--execute には --confirm-name <組織の名前> が要ります");
    const done = await deleteTenant(db, tenantId, {
      confirmName,
      supportTenantId: process.env.SUPPORT_TENANT_ID ?? null,
    });
    process.stdout.write(`${JSON.stringify({ mode: "deleted", tenantId, counts: done.counts })}\n`);
  } finally {
    await pool.end();
  }
}

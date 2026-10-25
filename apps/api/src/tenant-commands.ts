import { createDb, type RootDb } from "./db/client.ts";
import { withTenant } from "./db/tenant.ts";
import {
  loadPreRegistrationForTenant,
  markPreRegistrationConverted,
} from "./domains/growth/index.ts";
import { deleteTenant, planTenantDeletion } from "./offboarding/delete-tenant.ts";
import { applicationSourceFor } from "./onboarding/application-source.ts";
import { createTenant, parseTenantApplication } from "./onboarding/create-tenant.ts";
import { withPreRegistration } from "./onboarding/from-pre-registration.ts";
import { planPersonData } from "./person-data/plan-person-data.ts";

// 組織を作る・1人分を数える・組織を消す、の運営のコマンド(cli.ts から呼ぶ。手順は docs/runbooks/)。
// 本番の DB に書く(読む)ので人が打つ。接続は移行と同じ表の持ち主。

const appEnv = process.env.APP_ENV ?? "local";
// 未指定なら node-postgres が PGHOST / PGUSER / PGPASSWORD / PGDATABASE を読む(本番の移行タスク)
const migrationUrl = process.env.MIGRATION_DATABASE_URL;

/**
 * 申し込みを受けた組織を作る。--execute が無ければ、流してから取り消す(試し)。結果は JSON 1行(名前・メールは出さない)。
 * 申し込みは置き場(S3)から読む。引数はキーだけ(CloudTrail に名前・メールを残さない)。
 * --from-pre-registration <事前登録の ID> … 公開の LP で本人が確認した事前登録から、組織の名前と最初の管理者のメールを
 * 埋める(docs/designs/0025-public-landing-page.md の 5)。作ったら事前登録を converted にする(運営の組織の監査ログに残る)
 */
export async function createTenantCommand(args: string[]) {
  const [key, ...flags] = args;
  if (!key) throw new Error("置き場のキーがありません: create-tenant applications/<申込番号>.json");
  const execute = flags.includes("--execute");
  const confirmName = flagValue(flags, "--confirm-name");
  const preRegistrationId = flagValue(flags, "--from-pre-registration");
  if (execute && !confirmName)
    throw new Error("--execute には --confirm-name <組織の名前> が要ります");
  const supportTenantId = process.env.SUPPORT_TENANT_ID || null;
  const source = applicationSourceFor({ appEnv, bucket: process.env.APPLICATIONS_BUCKET });
  const json = await source.read(key);
  const { db, pool } = createDb(migrationUrl);
  try {
    const { application, ignoredKeys } = preRegistrationId
      ? parseTenantApplication(
          await fillFromPreRegistration(db, supportTenantId, preRegistrationId, json),
        )
      : parseTenantApplication(json);
    const created = await createTenant(db, application, { execute, confirmName, supportTenantId });
    if (execute && preRegistrationId && supportTenantId) {
      await linkPreRegistration(db, supportTenantId, preRegistrationId, created.tenantId);
    }
    const from = preRegistrationId ? { preRegistrationId } : {};
    const line = execute
      ? { mode: "created", ...created, ...from, ignoredKeys }
      : {
          mode: "plan",
          timeZone: created.timeZone,
          mfaRequired: created.mfaRequired,
          adminOtherMemberships: created.adminOtherMemberships,
          ...from,
          ignoredKeys,
        };
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

function flagValue(flags: string[], name: string): string | undefined {
  const at = flags.indexOf(name);
  return at >= 0 ? flags[at + 1] : undefined;
}

/** 確認済みの事前登録(運営の組織の持ち物)の名前とメールで、申込書を埋めた JSON を返す */
async function fillFromPreRegistration(
  db: RootDb,
  supportTenantId: string | null,
  id: string,
  json: string,
): Promise<string> {
  if (!supportTenantId) {
    throw new Error("事前登録は運営の組織の持ち物です。SUPPORT_TENANT_ID を入れてください");
  }
  const pre = await withTenant(db, supportTenantId, (tx) =>
    loadPreRegistrationForTenant(tx, supportTenantId, id),
  );
  if (!pre) {
    throw new Error(
      `確認済みの事前登録がありません: ${id}(確認待ち・もう組織にした・消えた、のどれか。何も作っていません)`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("申し込みが JSON として読めません(置き場のファイルを確かめてください)");
  }
  return JSON.stringify(withPreRegistration(raw, pre));
}

/**
 * 作った組織に事前登録をつなぐ(converted)。組織を作ったのとは別のトランザクション(運営の組織の文脈)。
 * 失敗しても組織は残るので、ID だけを言って止める(流し直しは手順書 tenant-provisioning.md)
 */
async function linkPreRegistration(
  db: RootDb,
  supportTenantId: string,
  id: string,
  tenantId: string,
) {
  const linked = await withTenant(db, supportTenantId, (tx) =>
    markPreRegistrationConverted(tx, supportTenantId, id, tenantId),
  );
  if (!linked) {
    throw new Error(
      `組織は作りました(${tenantId})が、事前登録 ${id} はほかの組織につながっていました。手順書の「事前登録から」の 4 を見てください`,
    );
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

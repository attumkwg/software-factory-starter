import { sql } from "drizzle-orm";
import { MANUAL_AUDIT_ACTIONS, recordAudit } from "../audit/index.ts";
import type { RootDb, TenantTx } from "../db/client.ts";
import { projects, tasks } from "../db/schema.ts";
import { withTenant } from "../db/tenant.ts";
import { TENANT_TABLES } from "../offboarding/delete-tenant.ts";

// 営業のデモ用の組織を、毎晩きれいな状態に戻す(運営のコマンド demo-reset。docs/specs/0053-sales-kit.md)。
// **stg(か手元・プレビュー)だけ**。デモの組織は DEMO_TENANT_ID で1つだけ指し、運営の組織とは別。
// 組織・人(ログインはそのまま)・契約のプラン・入れた機能・同意・監査ログは残し、ほかの組織のデータを消して、決まったデモのデータを入れ直す。
// 本番の個人データは使わない(デモのデータは下の DEMO_DATA だけ)。

/** 戻しても残す表(ログイン・契約・見せる機能・記録)。要配慮の表(sensitive.)はデモに置かないので触らない */
const KEEP = new Set<string>([
  "legal.notices",
  "legal.consents",
  "platform.tenant_plans",
  "platform.feature_flags",
  "platform.audit_events",
  "organizations.users",
  "organizations.tenants",
]);
/** 消す表(TENANT_TABLES の順 = 子から先。表を足せば自動でここに入る) */
export const DEMO_RESET_TABLES = TENANT_TABLES.filter(
  (t) => !KEEP.has(t) && !t.startsWith("sensitive."),
);

/** デモのデータ(偽の題名だけ。自分のプロダクトに合わせて直す) */
export const DEMO_DATA: { name: string; tasks: { title: string; done?: boolean }[] }[] = [
  {
    name: "新しい現場の段取り",
    tasks: [
      { title: "見積もりを出す", done: true },
      { title: "職人さんの予定を押さえる", done: true },
      { title: "資材を発注する" },
      { title: "近所にあいさつに回る" },
    ],
  },
  {
    name: "月末の締め",
    tasks: [{ title: "請求書を出す" }, { title: "経費をまとめる" }],
  },
];

/** 流してよい環境か。APP_ENV を**はっきり**書いた stg・手元・テスト・プレビューで、DEMO_TENANT_ID がある時だけ */
export function demoTarget(env: Record<string, string | undefined>): string {
  const appEnv = env.APP_ENV;
  if (!appEnv || !["local", "test", "preview", "stg"].includes(appEnv))
    throw new Error(
      `APP_ENV=${appEnv ?? "(無い)"} ではデモを戻しません(stg・手元・プレビューだけ)`,
    );
  const tenantId = env.DEMO_TENANT_ID;
  if (!tenantId) throw new Error("DEMO_TENANT_ID がありません(デモ用の組織の ID)");
  if (tenantId === env.SUPPORT_TENANT_ID) throw new Error("運営の組織はデモにできません");
  return tenantId;
}

const table = (name: string) => {
  const [schema, rel] = name.split(".");
  return sql`${sql.identifier(schema as string)}.${sql.identifier(rel as string)}`;
};

export type DemoResetResult = {
  mode: "plan" | "reset";
  /** 消す(消した)行の数。表ごと */
  removed: Record<string, number>;
  /** 入れる(入れた)デモのデータ */
  inserted: { projects: number; tasks: number };
};

/** デモの組織の最初の管理者(計画の作った人にする)。いなければ止まる */
async function ownerOf(tx: TenantTx, tenantId: string): Promise<string> {
  const admin = await tx.execute<{ id: string }>(
    sql`select id from organizations.users where tenant_id = ${tenantId} and role = 'admin'
        order by created_at, id limit 1`,
  );
  const ownerId = admin.rows[0]?.id;
  if (!ownerId) throw new Error("デモの組織が無いか、管理者がいません(先に create-tenant で作る)");
  return ownerId;
}

/** 戻す表の、その組織の行を数える(execute なら消す)。順は子から先 */
async function clearRows(tx: TenantTx, tenantId: string, execute: boolean) {
  const removed: Record<string, number> = {};
  for (const t of DEMO_RESET_TABLES) {
    const where = sql`where tenant_id = ${tenantId}`;
    if (execute) {
      removed[t] = (await tx.execute(sql`delete from ${table(t)} ${where}`)).rowCount ?? 0;
      continue;
    }
    const r = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from ${table(t)} ${where}`,
    );
    removed[t] = r.rows[0]?.n ?? 0;
  }
  return removed;
}

/** デモのデータを入れる */
async function insertDemo(tx: TenantTx, tenantId: string, ownerId: string) {
  for (const p of DEMO_DATA) {
    const [project] = await tx
      .insert(projects)
      .values({ tenantId, name: p.name, createdBy: ownerId })
      .returning({ id: projects.id });
    if (!project) continue;
    await tx.insert(tasks).values(
      p.tasks.map((t) => ({
        tenantId,
        projectId: project.id,
        title: t.title,
        done: t.done ?? false,
      })),
    );
  }
}

/** 試し(数えるだけ)か、本番(1つのトランザクションで消して入れ直す) */
export async function resetDemo(
  db: RootDb,
  tenantId: string,
  opts: { execute: boolean },
): Promise<DemoResetResult> {
  return withTenant(db, tenantId, async (tx) => {
    const ownerId = await ownerOf(tx, tenantId);
    const removed = await clearRows(tx, tenantId, opts.execute);
    const inserted = {
      projects: DEMO_DATA.length,
      tasks: DEMO_DATA.reduce((a, p) => a + p.tasks.length, 0),
    };
    if (!opts.execute) return { mode: "plan", removed, inserted };
    await insertDemo(tx, tenantId, ownerId);
    await recordAudit(tx, {
      tenantId,
      actor: { kind: "system", id: null },
      action: MANUAL_AUDIT_ACTIONS.demoReset,
      target: { type: "organization", id: tenantId },
      outcome: "allowed",
      details: { tables: DEMO_RESET_TABLES.length },
    });
    return { mode: "reset", removed, inserted };
  });
}

/** demo-reset [--execute] */
export async function runDemoReset(
  db: RootDb,
  args: string[],
  env: Record<string, string | undefined>,
): Promise<string[]> {
  const tenantId = demoTarget(env);
  const execute = args.includes("--execute");
  const result = await resetDemo(db, tenantId, { execute });
  const line = JSON.stringify(result);
  return execute
    ? [line]
    : [line, "まだ戻していません。数を確かめて --execute を付けて流してください"];
}

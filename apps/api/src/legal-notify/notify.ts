import { sql } from "drizzle-orm";
import type { RootDb } from "../db/client.ts";
import { withTenant } from "../db/tenant.ts";
import { addNotices, countUnnotified, type LegalRef } from "../domains/legal/index.ts";

// 規約の変更のお知らせを、全部の組織の全員に積む(運営のコマンド legal-notify。docs/runbooks/legal-notice.md)。
// API にはしない(全員に送る操作を、API の鍵1本でできないように)。解約のコマンド(src/offboarding)と同じ考え。
// 接続は表の持ち主。FORCE RLS なので、組織ごとに文脈を付けて、組織の中の読み書きは領域 legal に任せる。

export type NoticePlan = LegalRef & {
  /** 組織ごとに、これから送る人数(もう送った人は数えない)。execute なら足した数 */
  counts: Record<string, number>;
};

/** お知らせを送る組織(運営の組織は除く)。組織の一覧はコマンド専用の関数で引く(ID だけ。移行 0010) */
async function noticeTenants(db: RootDb, supportTenantId: string | null): Promise<string[]> {
  const r = await db.execute<{ tenant_id: string }>(
    sql`select tenant_id from legal_notice_tenants() as tenant_id order by tenant_id`,
  );
  return r.rows.map((row) => row.tenant_id).filter((id) => id !== supportTenantId);
}

/**
 * 組織ごとに、まだ送っていない人を数える(execute なら、お知らせの行と出来事を足す)。
 * 途中で止まっても、流し直せば残りだけ送る(足せた行だけ出来事を積む)。
 */
export async function notifyLegalChange(
  db: RootDb,
  ref: LegalRef,
  opts: { execute: boolean; supportTenantId: string | null },
): Promise<NoticePlan> {
  const counts: Record<string, number> = {};
  for (const tenantId of await noticeTenants(db, opts.supportTenantId)) {
    counts[tenantId] = await withTenant(db, tenantId, (tx) =>
      opts.execute ? addNotices(tx, tenantId, ref) : countUnnotified(tx, tenantId, ref),
    );
  }
  return { ...ref, counts };
}

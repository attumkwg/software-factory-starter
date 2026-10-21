import {
  canAccept,
  currentVersion,
  LEGAL_VERSIONS,
  type LegalDocument,
  type LegalVersion,
} from "@app/shared";
import { sql } from "drizzle-orm";
import type { RootDb } from "../../db/client.ts";
import { withTenant } from "../../db/tenant.ts";
import { enqueue } from "../../outbox/index.ts";
import { listUserIds } from "../organizations/index.ts";
import { notices } from "./schema.ts";

// 規約の変更のお知らせを、組織の全員に積む(運営のコマンド legal-notify。docs/runbooks/legal-notice.md)。
// API にはしない(全員に送る操作を、API の鍵1本でできないように)。同じ人に同じ版は1回だけ(notices の一意)。
// 接続は表の持ち主(解約のコマンドと同じ)。FORCE RLS なので、組織ごとに文脈を付けて書く。

export type NoticePlan = {
  document: LegalDocument;
  version: number;
  /** 組織ごとに、これから送る人数(もう送った人は数えない) */
  counts: Record<string, number>;
};

/** 予告として送ってよい版か(公開済みで、まだ効いていない)。違えば理由 */
export function noticeProblem(
  ref: { document: LegalDocument; version: number },
  now: Date,
  versions: readonly LegalVersion[] = LEGAL_VERSIONS,
): string | null {
  const v = versions.find((x) => x.document === ref.document && x.version === ref.version);
  if (!v) return "版の一覧にありません";
  if (!canAccept(ref, now, versions)) return "公開前か、古い版です";
  if ((currentVersion(ref.document, now, versions)?.version ?? 0) >= ref.version) {
    return "もう効いている版です(予告になりません)";
  }
  return null;
}

/** お知らせを送る組織(運営の組織は除く)。組織の一覧はコマンド専用の関数で引く(ID だけ) */
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
  ref: { document: LegalDocument; version: number },
  opts: { execute: boolean; supportTenantId: string | null },
): Promise<NoticePlan> {
  const counts: Record<string, number> = {};
  for (const tenantId of await noticeTenants(db, opts.supportTenantId)) {
    counts[tenantId] = await withTenant(db, tenantId, async (tx) => {
      const userIds = await listUserIds(tx, tenantId);
      if (userIds.length === 0) return 0;
      const rows = userIds.map((userId) => ({ tenantId, userId, ...ref }));
      if (!opts.execute) {
        const sent = await tx.execute<{ n: number }>(
          sql`select count(*)::int as n from legal.notices
              where tenant_id = ${tenantId} and document = ${ref.document} and version = ${ref.version}`,
        );
        return userIds.length - (sent.rows[0]?.n ?? 0);
      }
      const added = await tx
        .insert(notices)
        .values(rows)
        .onConflictDoNothing()
        .returning({ id: notices.id, userId: notices.userId });
      for (const notice of added) {
        const scope = { tx, tenantId, userId: notice.userId };
        await enqueue(scope, "legal.change_notified", { noticeId: notice.id });
      }
      return added.length;
    });
  }
  return { ...ref, counts };
}

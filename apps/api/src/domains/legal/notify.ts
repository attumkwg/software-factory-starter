import {
  canAccept,
  currentVersion,
  LEGAL_VERSIONS,
  type LegalDocument,
  type LegalVersion,
} from "@app/shared";
import { and, count, eq } from "drizzle-orm";
import type { TenantTx } from "../../db/client.ts";
import { enqueue } from "../../outbox/index.ts";
import { listUserIds } from "../organizations/index.ts";
import { notices } from "./schema.ts";

// 規約の変更のお知らせを、1つの組織の全員に積む(docs/specs/0009-legal-consent.md)。
// 組織を順に回すのは運営のコマンド(src/legal-notify。接続プールを使うので領域の外)。ここは組織の文脈の中だけ。
// 同じ人に同じ版は1回だけ(notices の一意)。

export type LegalRef = { document: LegalDocument; version: number };

/** 予告として送ってよい版か(公開済みで、まだ効いていない)。違えば理由 */
export function noticeProblem(
  ref: LegalRef,
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

/** その組織で、まだ送っていない人の数(送らない) */
export async function countUnnotified(tx: TenantTx, tenantId: string, ref: LegalRef) {
  const userIds = await listUserIds(tx, tenantId);
  const [sent] = await tx
    .select({ n: count() })
    .from(notices)
    .where(
      and(
        eq(notices.tenantId, tenantId),
        eq(notices.document, ref.document),
        eq(notices.version, ref.version),
      ),
    );
  return userIds.length - (sent?.n ?? 0);
}

/** その組織の、まだ送っていない全員にお知らせの行と出来事を足す。足した数を返す */
export async function addNotices(tx: TenantTx, tenantId: string, ref: LegalRef) {
  const userIds = await listUserIds(tx, tenantId);
  if (userIds.length === 0) return 0;
  const added = await tx
    .insert(notices)
    .values(userIds.map((userId) => ({ tenantId, userId, ...ref })))
    .onConflictDoNothing()
    .returning({ id: notices.id, userId: notices.userId });
  for (const notice of added) {
    const scope = { tx, tenantId, userId: notice.userId };
    await enqueue(scope, "legal.change_notified", { noticeId: notice.id });
  }
  return added.length;
}

import {
  type AcceptedVersions,
  type ExportData,
  type LegalDocument,
  LegalDocumentSchema,
  type LegalVersionRef,
  type Role,
} from "@app/shared";
import { and, asc, eq, getTableColumns, max } from "drizzle-orm";
import type { TenantTx } from "../../db/client.ts";
import { beyondCursor, cursorTime, decodeCursor, toPage } from "../../db/paging.ts";
import type { TenantScope } from "../../db/scope.ts";
import { consents } from "./schema.ts";

// 同意の記録の読み書き(docs/specs/0009-legal-consent.md)。足すだけ(直す・消すは無い)。

export type ConsentSource = "sign_up" | "acceptance";
export type ConsentCapacity = "organization" | "individual";

/** 利用規約を管理者が同意したら「組織(契約者)として」。それ以外は本人として(設計書 U-3) */
export function capacityOf(role: Role, document: LegalDocument): ConsentCapacity {
  return document === "terms" && role === "admin" ? "organization" : "individual";
}

/** 本人の、文書ごとの「同意した最大の版」(認可の関所が毎回1回だけ引く) */
export async function findAcceptedVersions(
  tx: TenantTx,
  tenantId: string,
  userId: string,
): Promise<AcceptedVersions> {
  const rows = await tx
    .select({ document: consents.document, version: max(consents.version) })
    .from(consents)
    .where(and(eq(consents.tenantId, tenantId), eq(consents.userId, userId)))
    .groupBy(consents.document);
  const accepted: AcceptedVersions = {};
  for (const row of rows) {
    const document = LegalDocumentSchema.safeParse(row.document);
    if (document.success && row.version !== null) accepted[document.data] = row.version;
  }
  return accepted;
}

/** 同意を足す。同じ版への2回目は何もしない(最初の記録を残す) */
export async function recordConsents(
  s: TenantScope,
  input: { consents: LegalVersionRef[]; role: Role; source: ConsentSource },
): Promise<void> {
  if (input.consents.length === 0) return;
  await s.tx
    .insert(consents)
    .values(
      input.consents.map((c) => ({
        tenantId: s.tenantId,
        userId: s.userId,
        document: c.document,
        version: c.version,
        capacity: capacityOf(input.role, c.document),
        source: input.source,
      })),
    )
    .onConflictDoNothing();
}

/** 書き出し(解約の前にお客さんが持ち出す。docs/specs/0018-export-stream.md)。古い順に1ページずつ */
export async function exportLegalConsentsPage(
  s: TenantScope,
  after: string | null,
  limit: number,
): Promise<{ rows: ExportData["legalConsents"]; nextCursor: string | null }> {
  const cursor = after ? decodeCursor(after) : null;
  const rows = await s.tx
    .select({ ...getTableColumns(consents), cursorAt: cursorTime(consents.acceptedAt) })
    .from(consents)
    .where(
      and(
        eq(consents.tenantId, s.tenantId),
        beyondCursor(cursor, "asc", consents.acceptedAt, consents.id),
      ),
    )
    .orderBy(asc(consents.acceptedAt), asc(consents.id))
    .limit(limit + 1);
  const page = toPage(rows, limit, (r) => ({ at: r.cursorAt, id: r.id }));
  const mapped: ExportData["legalConsents"] = page.rows.map((r) => ({
    userId: r.userId,
    document: LegalDocumentSchema.parse(r.document),
    version: r.version,
    capacity: r.capacity === "organization" ? "organization" : "individual",
    source: r.source === "sign_up" ? "sign_up" : "acceptance",
    acceptedAt: r.acceptedAt.toISOString(),
  }));
  return { rows: mapped, nextCursor: page.nextCursor };
}

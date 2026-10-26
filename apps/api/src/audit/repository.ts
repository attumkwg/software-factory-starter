import type { AuditEvent, AuditEventPage } from "@app/shared";
import { and, asc, desc, eq, gt, gte, lt, type SQL } from "drizzle-orm";
import type { TenantScope } from "../db/scope.ts";
import { findUserNames } from "../domains/organizations/index.ts";
import { badRequest } from "../errors.ts";
import { auditEvents } from "./schema.ts";

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

// 続きの印は最後の行の ID(UUIDv7 は時刻の順に並ぶ)。中身に頼らせないよう base64url にして渡す
const encodeCursor = (id: string) => Buffer.from(id).toString("base64url");

function decodeCursor(cursor: string): string {
  const id = Buffer.from(cursor, "base64url").toString();
  if (!UUID.test(id)) throw badRequest("続きの印が正しくありません");
  return id;
}

/** 自社の監査ログを新しい順に。before は前のページの nextCursor */
export async function listAuditEvents(
  s: TenantScope,
  opts: { before?: string | undefined; limit: number },
): Promise<AuditEventPage> {
  const cursor = opts.before ? decodeCursor(opts.before) : null;
  const rows = await s.tx
    .select()
    .from(auditEvents)
    .where(
      and(eq(auditEvents.tenantId, s.tenantId), cursor ? lt(auditEvents.id, cursor) : undefined),
    )
    .orderBy(desc(auditEvents.id))
    .limit(opts.limit + 1);

  const page = rows.slice(0, opts.limit);
  const events = await toEvents(s, page);
  const last = page.at(-1);
  return {
    events,
    nextCursor: rows.length > opts.limit && last ? encodeCursor(last.id) : null,
  };
}

type Row = typeof auditEvents.$inferSelect;

/** 行 → 画面と同じ形(自社の人なら名前を足す。値は入っていない) */
async function toEvents(s: TenantScope, rows: Row[]): Promise<AuditEvent[]> {
  const userIds = [
    ...new Set(
      rows.filter((r) => r.actorKind === "user" && r.actorId).map((r) => r.actorId as string),
    ),
  ];
  const names = await findUserNames(s.tx, s.tenantId, userIds);
  return rows.map((r) => ({
    id: r.id,
    occurredAt: r.occurredAt.toISOString(),
    actor: {
      kind: r.actorKind,
      id: r.actorId,
      name: r.actorKind === "user" && r.actorId ? (names.get(r.actorId) ?? null) : null,
    },
    action: r.action,
    target: r.targetType && r.targetId ? { type: r.targetType, id: r.targetId } : null,
    outcome: r.outcome,
    requestId: r.requestId,
    details: (r.details ?? {}) as Record<string, unknown>,
  }));
}

/**
 * 監査ログの書き出し(docs/specs/0056-sso-scim-ip-audit-export.md の段3)。期間 [start, end) の自社の行を、
 * **古い順に**1ページずつ。after は前のページの最後の行の ID(UUIDv7 は時刻の順)
 */
export async function auditEventsInRangePage(
  s: TenantScope,
  range: { start: Date; end: Date },
  after: string | null,
  limit: number,
): Promise<{ rows: AuditEvent[]; nextCursor: string | null }> {
  const conditions: (SQL | undefined)[] = [
    eq(auditEvents.tenantId, s.tenantId),
    gte(auditEvents.occurredAt, range.start),
    lt(auditEvents.occurredAt, range.end),
    after ? gt(auditEvents.id, after) : undefined,
  ];
  const rows = await s.tx
    .select()
    .from(auditEvents)
    .where(and(...conditions))
    .orderBy(asc(auditEvents.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    rows: await toEvents(s, page),
    nextCursor: rows.length > limit && last ? last.id : null,
  };
}

/** データの書き出し(docs/specs/0018-export-stream.md)。自社の監査ログを新しい順に1ページずつ */
export async function exportAuditEventsPage(
  s: TenantScope,
  after: string | null,
  limit: number,
): Promise<{ rows: AuditEvent[]; nextCursor: string | null }> {
  const page = await listAuditEvents(s, { before: after ?? undefined, limit });
  return { rows: page.events, nextCursor: page.nextCursor };
}

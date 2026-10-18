import type { AuditEvent, AuditEventPage } from "@app/shared";
import { and, desc, eq, lt } from "drizzle-orm";
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
  const userIds = [
    ...new Set(
      page.filter((r) => r.actorKind === "user" && r.actorId).map((r) => r.actorId as string),
    ),
  ];
  const names = await findUserNames(s.tx, s.tenantId, userIds);

  const events: AuditEvent[] = page.map((r) => ({
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
  const last = page.at(-1);
  return {
    events,
    nextCursor: rows.length > opts.limit && last ? encodeCursor(last.id) : null,
  };
}

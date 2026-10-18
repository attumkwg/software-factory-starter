import type { TenantTx } from "../db/client.ts";
import { getRequestContext } from "../request-context.ts";
import { auditEvents } from "./schema.ts";

export type AuditEntry = {
  tenantId: string;
  actor: { kind: "user" | "support" | "system"; id: string | null };
  action: string;
  target?: { type: string; id: string } | null;
  outcome: "allowed" | "denied";
  /** 値は入れない(項目の名前・ID だけ) */
  details?: Record<string, unknown>;
};

/**
 * 監査ログに1行足す。**書き込みと同じトランザクション(テナントの文脈つき)で呼ぶ**。
 * 書き込みが取り消されれば、記録も一緒に消える(起きていないことは残らない)。
 */
export async function recordAudit(tx: TenantTx, entry: AuditEntry): Promise<void> {
  await tx.insert(auditEvents).values({
    tenantId: entry.tenantId,
    actorKind: entry.actor.kind,
    actorId: entry.actor.id,
    action: entry.action,
    targetType: entry.target?.type ?? null,
    targetId: entry.target?.id ?? null,
    outcome: entry.outcome,
    requestId: getRequestContext()?.requestId ?? null,
    details: entry.details ?? {},
  });
}

import type { Context } from "hono";
import type { AuditAction } from "./actions.ts";
import type { AuditEntry } from "./record.ts";

// 認可の関所が、書き込みの API の1回分を監査ログの1行にする(どの API でも同じ形)。
//   対象の ID … 作った(201)なら返した本文の id、それ以外はパスの `<対象>Id`
//   details    … ほかのパスの ID(例: タスクを作ったプロジェクト)と、直した項目の名前(値は入れない)

/** Hono のパス(/api/projects/:projectId/tasks)と実際のパスを突き合わせて、パスの値を取る */
function pathParams(handlerPath: string, actualPath: string): Record<string, string> {
  const pattern = handlerPath.split("/");
  const actual = actualPath.split("/");
  const out: Record<string, string> = {};
  pattern.forEach((seg, i) => {
    if (seg.startsWith(":") && actual[i]) out[seg.slice(1)] = decodeURIComponent(actual[i]);
  });
  return out;
}

async function createdId(c: Context): Promise<string | null> {
  if (c.res.status !== 201) return null;
  try {
    const body = (await c.res.clone().json()) as { id?: unknown };
    return typeof body.id === "string" ? body.id : null;
  } catch {
    return null;
  }
}

function changedFields(c: Context): string[] | undefined {
  if (c.req.method !== "PATCH") return undefined;
  // **検証を通った本文**の項目の名前だけ(決めた項目しか残らない)。生の本文のキーは使わない:
  // 好きな名前(メールアドレスなど)を送れば、それが記録に残ってしまう
  const body = (c.req as unknown as { valid(target: "json"): unknown }).valid("json");
  return body && typeof body === "object" ? Object.keys(body).sort() : undefined;
}

export async function auditEntryFor(
  c: Context,
  opts: {
    handlerPath: string;
    audit: AuditAction;
    tenantId: string;
    actor: AuditEntry["actor"];
    outcome: AuditEntry["outcome"];
  },
): Promise<AuditEntry> {
  const params = pathParams(opts.handlerPath, c.req.path);
  const targetKey = `${opts.audit.target}Id`;
  const targetId =
    opts.outcome === "allowed" ? ((await createdId(c)) ?? params[targetKey]) : params[targetKey];
  const { [targetKey]: _target, ...otherParams } = params;
  const fields = changedFields(c);
  return {
    tenantId: opts.tenantId,
    actor: opts.actor,
    action: opts.audit.action,
    target: targetId ? { type: opts.audit.target, id: targetId } : null,
    outcome: opts.outcome,
    details: { ...otherParams, ...(fields ? { fields } : {}) },
  };
}

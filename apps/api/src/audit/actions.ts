// 書き込みの API → 監査ログの名前(「対象.動作」)と、何に対してか。
// **書き込みの API(GET 以外・ログインが要る物)を足したら、ここにも1行**。無ければ単体テスト
// (test/unit/audit-coverage.test.ts)が落ちる。記録は認可の関所(src/authz/middleware.ts)が自動で取る。
//
// 名前は画面の文(apps/web/src/messages.ts の AUDIT_ACTION_LABELS)と、お客さんが読む記録の両方で使う。
// **一度使った名前は変えない**(古い記録が読めなくなる)。

/** param … 対象の ID が入るパスの名前(省略すると `<target>Id`) */
export type AuditAction = { action: string; target: string; param?: string };

export const AUDIT_ACTIONS: Readonly<Record<string, AuditAction>> = {
  "POST /api/projects": { action: "project.create", target: "project" },
  "DELETE /api/projects/{projectId}": { action: "project.delete", target: "project" },
  "POST /api/projects/{projectId}/tasks": { action: "task.create", target: "task" },
  "PATCH /api/tasks/{taskId}": { action: "task.update", target: "task" },
  "DELETE /api/tasks/{taskId}": { action: "task.delete", target: "task" },
  "POST /api/support-grants": { action: "support_grant.create", target: "support_grant" },
  "DELETE /api/support-grants/{grantId}": {
    action: "support_grant.revoke",
    target: "support_grant",
    param: "grantId",
  },
  // 社員の組織の記録(見る組織の記録は、ハンドラーが support.start で残す)
  "POST /api/support/sessions": { action: "support.start", target: "support_session" },
  "POST /api/support/end": { action: "support.end", target: "support_session" },
};

/** 関所の外(ログインの API など)で、手で記録する物 */
export const MANUAL_AUDIT_ACTIONS = {
  login: "auth.login",
  logout: "auth.logout",
} as const;

/**
 * 代理の社員が読んだ(GET)ときの名前。対象はパスの最後の `<対象>Id`(例 /api/projects/{projectId} → project)。
 * 一覧(ID が無い)は対象なしで、details の route で分かる。
 */
export function supportReadAction(openApiPath: string): AuditAction {
  const ids = [...openApiPath.matchAll(/\{([a-zA-Z]+)Id\}/g)].map((m) => m[1] as string);
  const last = ids.at(-1);
  return { action: "support.read", target: last ?? "none", param: last ? `${last}Id` : "none" };
}

export function auditActionFor(method: string, openApiPath: string): AuditAction | undefined {
  return AUDIT_ACTIONS[`${method} ${openApiPath}`];
}

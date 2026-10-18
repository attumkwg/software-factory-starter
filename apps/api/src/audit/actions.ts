// 書き込みの API → 監査ログの名前(「対象.動作」)と、何に対してか。
// **書き込みの API(GET 以外・ログインが要る物)を足したら、ここにも1行**。無ければ単体テスト
// (test/unit/audit-coverage.test.ts)が落ちる。記録は認可の関所(src/authz/middleware.ts)が自動で取る。
//
// 名前は画面の文(apps/web/src/messages.ts の AUDIT_ACTION_LABELS)と、お客さんが読む記録の両方で使う。
// **一度使った名前は変えない**(古い記録が読めなくなる)。

export type AuditAction = { action: string; target: string };

export const AUDIT_ACTIONS: Readonly<Record<string, AuditAction>> = {
  "POST /api/projects": { action: "project.create", target: "project" },
  "DELETE /api/projects/{projectId}": { action: "project.delete", target: "project" },
  "POST /api/projects/{projectId}/tasks": { action: "task.create", target: "task" },
  "PATCH /api/tasks/{taskId}": { action: "task.update", target: "task" },
  "DELETE /api/tasks/{taskId}": { action: "task.delete", target: "task" },
};

/** 関所の外(ログインの API など)で、手で記録する物 */
export const MANUAL_AUDIT_ACTIONS = {
  login: "auth.login",
  logout: "auth.logout",
} as const;

export function auditActionFor(method: string, openApiPath: string): AuditAction | undefined {
  return AUDIT_ACTIONS[`${method} ${openApiPath}`];
}

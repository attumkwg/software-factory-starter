import type { Role } from "@app/shared";

// ─────────────────────────────────────────────────────────────────────────────
// 認可の判断はここ1か所だけ。各 API の中に `if (role === ...)` を書かない。
// このファイルの変更は危険度「高」(CODEOWNERS で2人レビュー)。
// 人が読む「権限の表」は docs/authz/matrix.yaml。結合テストが両者の食い違いを落とす。
// ─────────────────────────────────────────────────────────────────────────────

/** 権限 → それを持つロール。 */
export const PERMISSIONS = {
  "me:read": ["admin", "member", "viewer"],
  "project:read": ["admin", "member", "viewer"],
  "project:create": ["admin", "member"],
  "project:delete": ["admin"],
  "task:read": ["admin", "member", "viewer"],
  "task:write": ["admin", "member"],
  // 監査ログ(docs/specs/0003-audit-log.md)。誰が何をしたかが分かるので、管理者だけ
  "audit:read": ["admin"],
  // サポートへの許可(docs/specs/0004-support-access.md)。組織の管理者だけ
  "support_grant:manage": ["admin"],
  // 社員が代理で入る。ロールに加えて「運営の組織の人か」をハンドラーが確かめる(代理の最中は閲覧者なので入れない)
  "support:start": ["admin", "member"],
  // 代理を終える(代理の最中は閲覧者)
  "support:end": ["admin", "member", "viewer"],
  // データの書き出し(docs/specs/0005-offboarding.md)。組織の全データが出るので管理者だけ
  "export:create": ["admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;
export const PUBLIC = "public";
export type RouteRule = Permission | typeof PUBLIC;

/**
 * API → 要る権限。キーは `メソッド OpenAPI のパス`。
 * **ここに無い API は誰も呼べない(既定は拒否)**。新しい API を足したら、ここと matrix.yaml に1行ずつ。
 */
export const ROUTE_RULES: Readonly<Record<string, RouteRule>> = {
  "GET /api/openapi.json": PUBLIC,
  "GET /api/auth/options": PUBLIC,
  "POST /api/auth/dev-login": PUBLIC,
  "POST /api/auth/login": PUBLIC,
  "POST /api/auth/mfa": PUBLIC,
  "POST /api/auth/sign-up": PUBLIC,
  "POST /api/auth/confirm-sign-up": PUBLIC,
  "POST /api/auth/resend-code": PUBLIC,
  "POST /api/auth/forgot-password": PUBLIC,
  "POST /api/auth/reset-password": PUBLIC,
  "POST /api/auth/logout": PUBLIC,
  "GET /api/me": "me:read",
  "GET /api/projects": "project:read",
  "POST /api/projects": "project:create",
  "GET /api/projects/{projectId}": "project:read",
  "DELETE /api/projects/{projectId}": "project:delete",
  "GET /api/projects/{projectId}/tasks": "task:read",
  "POST /api/projects/{projectId}/tasks": "task:write",
  "PATCH /api/tasks/{taskId}": "task:write",
  "DELETE /api/tasks/{taskId}": "task:write",
  "GET /api/audit-events": "audit:read",
  "GET /api/support-grants": "support_grant:manage",
  "POST /api/support-grants": "support_grant:manage",
  "DELETE /api/support-grants/{grantId}": "support_grant:manage",
  "POST /api/support/sessions": "support:start",
  "POST /api/support/end": "support:end",
  "POST /api/exports": "export:create",
};

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/** Hono のパス(`/api/projects/:projectId`)を OpenAPI の形(`/api/projects/{projectId}`)にそろえる。 */
export function toOpenApiPath(honoPath: string): string {
  return honoPath.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

/** 決まっていなければ undefined(= 拒否)。 */
export function ruleFor(method: string, openApiPath: string): RouteRule | undefined {
  return ROUTE_RULES[`${method.toUpperCase()} ${openApiPath}`];
}

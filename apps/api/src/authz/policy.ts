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
  // 本人のアカウント(二段階認証・メール・パスワード。docs/specs/0006-account-security.md)。
  // 対象はいつもセッションの本人だけ。代理の最中は使えない(NOT_DURING_SUPPORT)
  "account:manage": ["admin", "member", "viewer"],
  // 組織の二段階認証の必須。管理者だけ
  "mfa_requirement:manage": ["admin"],
  // 利用規約・プライバシーポリシーに同意する(docs/specs/0009-legal-consent.md)。対象はいつもセッションの本人だけ。
  // 管理者の利用規約の同意は「組織として」(ロールで決まる)。代理の最中は使えない(NOT_DURING_SUPPORT)
  "legal:accept": ["admin", "member", "viewer"],
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
  // 公開の LP(apps/site)の事前登録と見た数(docs/specs/0025-public-landing-page.md)。ログインを見ない。
  // テナントはリクエストから決めず、設定の運営の組織に固定(domains/growth/routes.ts)。設定が無ければ 404
  "POST /api/public/pre-registrations": PUBLIC,
  "POST /api/public/pre-registrations/confirm": PUBLIC,
  "POST /api/public/pre-registrations/withdraw": PUBLIC,
  "POST /api/public/lp-views": PUBLIC,
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
  "GET /api/account": "account:manage",
  "POST /api/account/reauth": "account:manage",
  "POST /api/account/password": "account:manage",
  "POST /api/account/email": "account:manage",
  "POST /api/account/email/confirm": "account:manage",
  "POST /api/account/mfa/setup": "account:manage",
  "POST /api/account/mfa/enable": "account:manage",
  "POST /api/account/mfa/disable": "account:manage",
  "GET /api/organization/mfa-requirement": "mfa_requirement:manage",
  "POST /api/organization/mfa-requirement": "mfa_requirement:manage",
  "DELETE /api/organization/mfa-requirement": "mfa_requirement:manage",
  "POST /api/legal/consents": "legal:accept",
};

/**
 * 社員の代理ログインの最中は使えない権限。代理のロールは閲覧者に固定だが、閲覧者でも持つ権限のうち、
 * 「本人のアカウント」のように社員自身の物を触る物はここで止める(docs/specs/0006-account-security.md)。
 */
export const NOT_DURING_SUPPORT: ReadonlySet<Permission> = new Set([
  "account:manage",
  // 社員がお客さんの代わりに規約に同意しない(docs/specs/0009-legal-consent.md)
  "legal:accept",
]);

/**
 * 関所がトランザクションを閉じてからハンドラーを呼ぶ権限。ハンドラーが外(Cognito)を待つので、
 * その間 DB のトランザクションを開いたままにしない(apps/api/CLAUDE.md の DB の時間切れ)。
 * ハンドラーは c.var.tx を使わず、Cognito の後に自分で withTenant を開く。
 */
export const OUTSIDE_TRANSACTION: ReadonlySet<Permission> = new Set(["account:manage"]);

/**
 * 組織が二段階認証を必須にしていて、本人がまだ設定していない(設定待ち)の間に通る API。
 * ほかは 403 mfa_setup_required(画面は /account へ回す)。ログアウトは公開の API なので、ここに無くても通る。
 */
export const ALLOWED_DURING_MFA_SETUP: ReadonlySet<string> = new Set([
  "GET /api/me",
  "GET /api/account",
  "POST /api/account/reauth",
  "POST /api/account/mfa/setup",
  "POST /api/account/mfa/enable",
]);

/**
 * 同意し直しが要る版に、まだ同意していない(同意待ち)の間に通る API(docs/specs/0009-legal-consent.md)。
 * ほかは 403 terms_acceptance_required(画面は /legal/accept へ回す)。ログアウトは公開の API なので、ここに無くても通る。
 * 同意待ちと二段階認証の設定待ちの両方にかかる人が行き詰まらないよう、関所は「どちらかの一覧にある API」を
 * どちらの待ちでも通す(画面は同意 → 二段階認証の設定、の順に回す)。
 */
export const ALLOWED_DURING_TERMS_ACCEPTANCE: ReadonlySet<string> = new Set([
  "GET /api/me",
  "POST /api/legal/consents",
]);

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

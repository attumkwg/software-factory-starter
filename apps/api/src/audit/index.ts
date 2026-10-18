// 監査ログ(共通の仕組み)の入口。記録は認可の関所(src/authz/middleware.ts)が自動で取る。
// 関所の外(ログインなど)で記録するときだけ recordAudit を使う。
export { AUDIT_ACTIONS, auditActionFor, MANUAL_AUDIT_ACTIONS } from "./actions.ts";
export { type AuditEntry, recordAudit } from "./record.ts";
export { auditRoutes } from "./routes.ts";

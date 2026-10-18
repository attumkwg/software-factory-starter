import type { Role } from "@app/shared";

// 画面でボタンを出すかどうかだけの判断。**守りは API 側**(画面で隠しても API は必ず確かめる)。
export const canWrite = (role: Role) => role === "admin" || role === "member";
export const canDeleteProject = (role: Role) => role === "admin";
/** 監査ログ(誰が何をしたか)は管理者だけ。API も admin 以外は 403 */
export const canReadAudit = (role: Role) => role === "admin";

const ROLE_LABELS: Record<Role, string> = { admin: "管理者", member: "メンバー", viewer: "閲覧者" };
export const roleLabel = (role: Role) => ROLE_LABELS[role];

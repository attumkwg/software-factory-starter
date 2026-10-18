import type { Me, Role } from "@app/shared";

// 画面でボタンを出すかどうかだけの判断。**守りは API 側**(画面で隠しても API は必ず確かめる)。
export const canWrite = (role: Role) => role === "admin" || role === "member";
export const canDeleteProject = (role: Role) => role === "admin";
/** 監査ログ(誰が何をしたか)は管理者だけ。API も admin 以外は 403 */
export const canReadAudit = (role: Role) => role === "admin";

const ROLE_LABELS: Record<Role, string> = { admin: "管理者", member: "メンバー", viewer: "閲覧者" };
export const roleLabel = (role: Role) => ROLE_LABELS[role];

/** サポートへの許可を出す・取り消す(組織の管理者だけ。代理の社員は閲覧者なので出ない) */
export const canManageSupportGrants = (me: Me) => me.role === "admin" && !me.support;
/** 運営の社員が、サポート番号で代理ログインに入る画面 */
export const canStartSupport = (me: Me) => me.isSupportStaff === true && !me.support;
/** 「設定」(監査ログ・サポートへの許可・データの書き出し)。組織の管理者だけ。代理の社員には出ない */
export const canOpenSettings = (me: Me) => me.role === "admin" && !me.support;

import type { Role } from "@app/shared";

// 画面でボタンを出すかどうかだけの判断。**守りは API 側**(画面で隠しても API は必ず確かめる)。
export const canWrite = (role: Role) => role === "admin" || role === "member";
export const canDeleteProject = (role: Role) => role === "admin";

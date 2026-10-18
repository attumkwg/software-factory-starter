import type { AuditEvent } from "@app/shared";

// 監査ログの画面の文(apps/api/src/audit/actions.ts の名前 → 人が読む文)。文言は自由に変えてよい。
// 名前を足したら、ここにも足す(無い名前はそのまま出る)。

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "auth.login": "ログインした",
  "auth.logout": "ログアウトした",
  "project.create": "プロジェクトを作った",
  "project.delete": "プロジェクトを消した",
  "task.create": "タスクを作った",
  "task.update": "タスクを直した",
  "task.delete": "タスクを消した",
};

const TARGET_LABELS: Record<string, string> = { project: "プロジェクト", task: "タスク" };
const FIELD_LABELS: Record<string, string> = { title: "題名", done: "完了" };

export function auditActionLabel(e: AuditEvent): string {
  const base = AUDIT_ACTION_LABELS[e.action] ?? e.action;
  const fields = Array.isArray(e.details.fields)
    ? (e.details.fields as unknown[]).map((f) => FIELD_LABELS[String(f)] ?? String(f))
    : [];
  return fields.length > 0 ? `${base}(${fields.join("・")})` : base;
}

export function auditActorLabel(e: AuditEvent): string {
  switch (e.actor.kind) {
    case "support":
      return "サポート(運営)";
    case "system":
      return "仕組み(自動)";
    default:
      // 消された人は名前が引けない
      return e.actor.name ?? "(いまはいない人)";
  }
}

/** 対象の種類と ID の頭(全部は長いので。問い合わせのときは requestId を使う) */
export function auditTargetLabel(e: AuditEvent): string {
  if (!e.target) return "—";
  return `${TARGET_LABELS[e.target.type] ?? e.target.type} ${e.target.id.slice(-8)}`;
}

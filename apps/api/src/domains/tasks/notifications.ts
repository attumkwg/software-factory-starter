import { and, eq } from "drizzle-orm";
import type { TenantTx } from "../../db/client.ts";
import type { MailMessage } from "../../mail/index.ts";
import type { OutboxEvent, OutboxPayload } from "../../outbox/index.ts";
import { findContact, findTaskMailEnabled } from "../organizations/index.ts";
import { findProjectOwner } from "../projects/index.ts";
import { tasks } from "./schema.ts";

// 「タスクが完了した」を、プロジェクトを作った人にメールで知らせる(docs/specs/0002-task-completed-mail.md)。
// アウトボックスの受け手(outbox/handlers.ts)が、送る直前にここで宛先と本文を組み立てる。
// 出来事の中身は ID だけなので、名前やメールはこの時点の DB から読む(消された人・消された物には送らない)。

export type NoMail = { skip: string };

export async function taskCompletedMail(
  tx: TenantTx,
  event: OutboxEvent,
  payload: OutboxPayload<"tasks.task_completed">,
  appUrl: string,
): Promise<MailMessage | NoMail> {
  const tenantId = event.tenantId;
  const [task] = await tx
    .select({ title: tasks.title, done: tasks.done })
    .from(tasks)
    .where(and(eq(tasks.tenantId, tenantId), eq(tasks.id, payload.taskId)));
  if (!task) return { skip: "task_deleted" };
  // 送るまでの間に「未完了」に戻されたら、知らせない
  if (!task.done) return { skip: "task_reopened" };
  // 組織の管理者が止めていたら、知らせない(docs/specs/0093-task-mail-switch.md)。
  // 送る直前に見るので、止める前に積まれた出来事も送らない。済みにするので、戻しても後から送らない
  if (!(await findTaskMailEnabled(tx, tenantId))) return { skip: "mail_off_by_organization" };

  const project = await findProjectOwner(tx, tenantId, payload.projectId);
  if (!project) return { skip: "project_deleted" };
  // 自分で完了にしたものは、自分に知らせない
  if (payload.completedBy === project.createdBy) return { skip: "completed_by_owner" };

  const owner = await findContact(tx, tenantId, project.createdBy);
  if (!owner) return { skip: "owner_deleted" };

  return {
    to: owner.email,
    subject: `タスク「${task.title}」が完了しました`,
    text: [
      `${owner.name} さん`,
      "",
      `プロジェクト「${project.name}」のタスク「${task.title}」が完了しました。`,
      "",
      `${appUrl}/projects/${payload.projectId}`,
      "",
      "このメールは、プロジェクトを作った方にお送りしています。",
    ].join("\n"),
    // 同じ出来事から作ったメールは同じ ID(アウトボックスは、まれに同じ出来事を2回届ける)
    messageId: `<task-completed.${event.id}@${new URL(appUrl).hostname}>`,
  };
}

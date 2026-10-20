import { IdSchema } from "@app/shared";
import { z } from "zod";

// アウトボックスに書ける出来事の一覧と、中身の形。名前は「領域.出来事(過去形)」。
// 足すのはよいが、中身の項目を消す・意味を変えるのはしない(受け手が古い形のまま動いている)。
// 中身は「何が」を指す ID だけにする。個人情報や本文は入れない(受け手が必要なら API で読み直す)。
export const OUTBOX_TOPICS = {
  "tasks.task_completed": z.object({
    taskId: IdSchema,
    projectId: IdSchema,
    // 完了にした人(自分で完了にしたものは自分に知らせない)。足す前に積まれた出来事には無い
    completedBy: IdSchema.optional(),
  }),
  // 本人へのお知らせ(docs/specs/0006-account-security.md)。宛先は送る直前に DB から読む
  "organizations.password_changed": z.object({ userId: IdSchema }),
  "organizations.mfa_enabled": z.object({ userId: IdSchema }),
  "organizations.mfa_disabled": z.object({ userId: IdSchema }),
  // 宛先は古いアドレス(email_changes.previous_email)
  "organizations.email_changed": z.object({ emailChangeId: IdSchema }),
} as const;

export type OutboxTopic = keyof typeof OUTBOX_TOPICS;
export type OutboxPayload<T extends OutboxTopic> = z.infer<(typeof OUTBOX_TOPICS)[T]>;

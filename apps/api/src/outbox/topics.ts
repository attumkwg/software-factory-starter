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
    // 完了にした時点で、組織が「タスクが完了したメール」を止めていたか(docs/designs/0089-task-mail-switch.md の 13)。
    // 止めていた間に完了した分は、送る前に戻しても送らない。足す前に積まれた出来事には無い(= 止めていなかった扱い)
    mailOffAtCompletion: z.boolean().optional(),
  }),
  // 本人へのお知らせ(docs/specs/0006-account-security.md)。宛先は送る直前に DB から読む
  "organizations.password_changed": z.object({ userId: IdSchema }),
  "organizations.mfa_enabled": z.object({ userId: IdSchema }),
  "organizations.mfa_disabled": z.object({ userId: IdSchema }),
  // 宛先は古いアドレス(email_changes.previous_email)
  "organizations.email_changed": z.object({ emailChangeId: IdSchema }),
  // 招待のメール(docs/specs/0027-invitations.md)。宛先・組織・期限は invitations の行から読み、リンクは送る直前に作る
  "organizations.invitation_created": z.object({ invitationId: IdSchema }),
  // 運営のコマンドが組織を作った: 最初の管理者への案内(docs/specs/0027-invitations.md)。宛先は users の行
  "organizations.tenant_opened": z.object({ userId: IdSchema }),
  // 規約の変更のお知らせ(docs/specs/0009-legal-consent.md)。宛先・版は legal.notices の行から読む
  "legal.change_notified": z.object({ noticeId: IdSchema }),
  // 公開の LP の事前登録の確認のメール(docs/specs/0025-public-landing-page.md)。宛先・リンクは登録の行から読む
  "growth.pre_registration_received": z.object({ preRegistrationId: IdSchema }),
  // 写真・ファイル(docs/specs/0072-file-storage.md)。上げ終えた: 中身を読み直して確かめ、付いた情報を消して見せる
  "files.file_uploaded": z.object({ fileId: IdSchema }),
  // 行が消えた(本人・タスクやプロジェクトの cascade・解約)。積むのは DB の引き金(移行 0023)。中身を消す
  "files.file_deleted": z.object({ fileId: IdSchema }),
} as const;

export type OutboxTopic = keyof typeof OUTBOX_TOPICS;
export type OutboxPayload<T extends OutboxTopic> = z.infer<(typeof OUTBOX_TOPICS)[T]>;

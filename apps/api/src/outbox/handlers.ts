import type { RootDb } from "../db/client.ts";
import { withTenant } from "../db/tenant.ts";
import { taskCompletedMail } from "../domains/tasks/index.ts";
import type { Logger } from "../logger.ts";
import type { Mailer } from "../mail/index.ts";
import type { OutboxHandler } from "./relay.ts";
import { OUTBOX_TOPICS, type OutboxTopic } from "./topics.ts";

export type HandlerDeps = {
  db: RootDb;
  logger: Logger;
  mailer: Mailer;
  /** メールの中のリンクの頭(https://app.example.com) */
  appUrl: string;
};

/**
 * 出来事ごとの宛先。外へ送るときはここに書く
 * (例: メールで知らせる・Slack に知らせる・検索の索引を直す・キャッシュを消す)。
 * 宛先の無い出来事は、送らずに dead になる(積み忘れより、宛先の書き忘れに気づけるように)。
 *
 * 失敗したら投げる → アウトボックスがやり直す。**同じ出来事が2回届くことがある**ので、
 * 2回送っても困らないように書く(メールは Message-ID を出来事ごとに固定している)。
 */
export function outboxHandlers(deps: HandlerDeps): Partial<Record<OutboxTopic, OutboxHandler>> {
  const { db, logger, mailer, appUrl } = deps;
  return {
    "tasks.task_completed": async (event) => {
      const payload = OUTBOX_TOPICS["tasks.task_completed"].parse(event.payload);
      // 宛先と本文は、その会社の文脈(RLS)の中で読む
      const mail = await withTenant(db, event.tenantId, (tx) =>
        taskCompletedMail(tx, event, payload, appUrl),
      );
      if ("skip" in mail) {
        logger.info({ eventId: event.id, reason: mail.skip }, "タスク完了のメールは送りません");
        return;
      }
      // DB のトランザクションの外で送る(Postfix が遅くても DB の接続を握らない)
      await mailer.send(mail);
      logger.info(
        { eventId: event.id, messageId: mail.messageId },
        "タスク完了のメールを渡しました",
      );
    },
  };
}

import type { Logger } from "../logger.ts";
import type { OutboxHandler } from "./relay.ts";
import type { OutboxTopic } from "./topics.ts";

/**
 * 出来事ごとの宛先。いまは記録するだけ。外へ送るときはここに書く
 * (例: Slack に知らせる・検索の索引を直す・キャッシュを消す・ほかの領域の表を直す)。
 * 宛先の無い出来事は、送らずに dead になる(積み忘れより、宛先の書き忘れに気づけるように)。
 */
export function outboxHandlers(logger: Logger): Partial<Record<OutboxTopic, OutboxHandler>> {
  return {
    "tasks.task_completed": async (event) => {
      logger.info(
        { eventId: event.id, topic: event.topic },
        "タスクが完了しました(宛先: 記録だけ)",
      );
    },
  };
}

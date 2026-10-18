import type { TenantScope } from "../db/scope.ts";
import { outbox } from "./schema.ts";
import { OUTBOX_TOPICS, type OutboxPayload, type OutboxTopic } from "./topics.ts";

/**
 * 起きたことを送信待ちに積む。**業務の変更と同じトランザクション(scope.tx)で呼ぶ**。
 * 失敗してリクエストが取り消されれば、積んだ物も一緒に消える(送ってはいけない物は送られない)。
 */
export async function enqueue<T extends OutboxTopic>(
  scope: TenantScope,
  topic: T,
  payload: OutboxPayload<T>,
): Promise<void> {
  await scope.tx.insert(outbox).values({
    tenantId: scope.tenantId,
    topic,
    payload: OUTBOX_TOPICS[topic].parse(payload),
  });
}

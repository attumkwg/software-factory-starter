import { scrubErrorText } from "@app/logging";
import { sql } from "drizzle-orm";
import type { RootDb } from "../db/client.ts";
import type { Logger } from "../logger.ts";
import { runOutsideRequestContext } from "../request-context.ts";
import type { OutboxTopic } from "./topics.ts";

// アウトボックスの送り出し(docs/adr/0006-outbox.md)。API のプロセスの中で、1秒ごとに回る。
//
//   1. 送るべき物を取る(outbox_claim)。取った物には「借りている期限」が付き、ほかの台は取らない
//      (API が何台あっても、DB の FOR UPDATE SKIP LOCKED で同じ物を2台が取らない)
//   2. 宛先(handlers)ごとに送る
//   3. 送れたら印(outbox_mark_sent)。だめなら時間をおいてやり直す(1秒・2秒・4秒…最大1時間)。
//      maxAttempts 回だめなら、あきらめて dead にする(人が見て直す)
//
// **同じ出来事が2回届くことがある**(送った直後に落ちて、印を付けられなかったとき)。
// 受け手は event.id で重ねて処理しないように書く。順番も保証しない。
//
// 重くなったら(1台で追いつかない・API の応答が遅くなる)、同じイメージで別のサービスとして動かす
// (OUTBOX_RELAY=on をそちらだけに)。

export type OutboxEvent = {
  id: string;
  tenantId: string;
  topic: OutboxTopic;
  payload: unknown;
  attempts: number;
  createdAt: Date;
};
export type OutboxHandler = (event: OutboxEvent) => Promise<void>;

export type RelayOptions = {
  db: RootDb;
  logger: Logger;
  handlers: Partial<Record<OutboxTopic, OutboxHandler>>;
  intervalMs?: number;
  batchSize?: number;
  leaseSeconds?: number;
  maxAttempts?: number;
  /** やり直しまでの秒数(試した回数から)。テストで短くする */
  backoffSeconds?: (attempts: number) => number;
};

type ClaimedRow = {
  id: string;
  tenant_id: string;
  topic: OutboxTopic;
  payload: unknown;
  attempts: number;
  created_at: Date | string;
};

const defaultBackoff = (attempts: number) => Math.min(2 ** (attempts - 1), 3600);

/** 1回分だけ回す(テストと、止めるときの最後の1回に使う)。送った数を返す。 */
export async function relayOnce(opts: RelayOptions): Promise<number> {
  const {
    db,
    logger,
    handlers,
    batchSize = 20,
    leaseSeconds = 30,
    maxAttempts = 10,
    backoffSeconds = defaultBackoff,
  } = opts;
  const { rows } = await db.execute<ClaimedRow>(
    sql`select id, tenant_id, topic, payload, attempts, created_at from outbox_claim(${batchSize}, ${leaseSeconds})`,
  );
  let sent = 0;
  for (const row of rows) {
    const event: OutboxEvent = {
      id: row.id,
      tenantId: row.tenant_id,
      topic: row.topic,
      payload: row.payload,
      attempts: row.attempts,
      createdAt: new Date(row.created_at),
    };
    const handler = handlers[event.topic];
    try {
      if (!handler) throw new Error(`宛先がありません: ${event.topic}`);
      await handler(event);
      await db.execute(sql`select outbox_mark_sent(${event.id})`);
      sent++;
    } catch (err) {
      const dead = event.attempts >= maxAttempts || !handler;
      // 失敗の文には値が入る(SMTP の「550 <宛先>」など)。ログの失敗の文と同じ伏せ字をかけてから残す(人が表を見て直す)
      const message = scrubErrorText(
        err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        500,
      );
      await db.execute(
        sql`select outbox_mark_failed(${event.id}, ${message}, ${backoffSeconds(event.attempts)}, ${dead})`,
      );
      logger[dead ? "error" : "warn"](
        {
          err,
          eventId: event.id,
          topic: event.topic,
          eventTenantId: event.tenantId,
          attempts: event.attempts,
        },
        dead ? "送れないのであきらめました" : "送れなかったので後でやり直します",
      );
    }
  }
  return sent;
}

/** 一定の間隔で回し続ける。止めるときは stop() を待つ(途中の1回が終わるまで)。 */
export function startOutboxRelay(opts: RelayOptions): { stop: () => Promise<void> } {
  const intervalMs = opts.intervalMs ?? 1_000;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();

  const tick = () => {
    // 送り出しはリクエストではないので、どのリクエストの ID も付けない
    running = runOutsideRequestContext(async () => {
      try {
        await relayOnce(opts);
      } catch (err) {
        // DB に届かないなど。次の回でやり直す(プロセスは落とさない)
        opts.logger.warn({ err }, "アウトボックスを読めませんでした");
      }
    }).finally(() => {
      if (!stopped) timer = setTimeout(tick, intervalMs);
    });
  };
  timer = setTimeout(tick, intervalMs);

  return {
    stop: async () => {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}

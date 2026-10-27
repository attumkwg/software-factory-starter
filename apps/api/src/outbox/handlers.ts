import type { RootDb, TenantTx } from "../db/client.ts";
import { withTenant } from "../db/tenant.ts";
import { handleFileDeleted, handleFileUploaded } from "../domains/files/index.ts";
import { type PublicSiteLinks, preRegistrationConfirmMail } from "../domains/growth/index.ts";
import { legalChangeMail } from "../domains/legal/index.ts";
import {
  type AccountNotice,
  accountNoticeMail,
  emailChangedMail,
  invitationMail,
  tenantOpenedMail,
} from "../domains/organizations/index.ts";
import { taskCompletedMail } from "../domains/tasks/index.ts";
import type { Logger } from "../logger.ts";
import type { Mailer, MailMessage } from "../mail/index.ts";
import type { ObjectStore } from "../storage/index.ts";
import type { OutboxEvent, OutboxHandler } from "./relay.ts";
import { OUTBOX_TOPICS, type OutboxTopic } from "./topics.ts";

export type HandlerDeps = {
  db: RootDb;
  logger: Logger;
  mailer: Mailer;
  /** メールの中のリンクの頭(https://app.example.com) */
  appUrl: string;
  /** 招待のリンクの署名の元(SESSION_SECRET。docs/specs/0027-invitations.md) */
  linkSecret: string;
  /** 公開の LP の URL とリンクの鍵(事前登録の確認のメール)。無ければ確認のメールは送らない */
  publicSite?: PublicSiteLinks | null;
  /** 写真・ファイルの置き場(docs/designs/0072-file-storage.md)。無ければファイルの出来事の宛先は無い */
  files?: ObjectStore | null;
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
  const { db, logger, mailer, appUrl, linkSecret, publicSite = null, files = null } = deps;

  /** 宛先と本文をその会社の文脈(RLS)の中で作り、DB のトランザクションの外で送る */
  async function sendIn(
    event: OutboxEvent,
    build: (tx: TenantTx) => Promise<MailMessage | { skip: string }>,
  ) {
    const mail = await withTenant(db, event.tenantId, build);
    if ("skip" in mail) {
      logger.info(
        { eventId: event.id, topic: event.topic, reason: mail.skip },
        "メールは送りません",
      );
      return;
    }
    await mailer.send(mail);
    logger.info(
      { eventId: event.id, topic: event.topic, messageId: mail.messageId },
      "メールを渡しました",
    );
  }

  /** パスワード・二段階認証のお知らせ(本人のいまのアドレスへ) */
  const accountNotice = (topic: AccountNotice) => (event: OutboxEvent) => {
    const payload = OUTBOX_TOPICS[topic].parse(event.payload);
    return sendIn(event, (tx) => accountNoticeMail(tx, { ...event, topic }, payload, appUrl));
  };

  // 写真・ファイル: 書き直しと中身の削除(置き場を待つのはトランザクションの外。ADR 0080)
  const fileHandlers = files
    ? {
        "files.file_uploaded": handleFileUploaded({ db, logger, store: files }),
        "files.file_deleted": handleFileDeleted({ store: files }),
      }
    : {};

  return {
    ...fileHandlers,
    "organizations.password_changed": accountNotice("organizations.password_changed"),
    "organizations.mfa_enabled": accountNotice("organizations.mfa_enabled"),
    "organizations.mfa_disabled": accountNotice("organizations.mfa_disabled"),
    "organizations.email_changed": (event) => {
      const payload = OUTBOX_TOPICS["organizations.email_changed"].parse(event.payload);
      return sendIn(event, (tx) => emailChangedMail(tx, event, payload, appUrl));
    },
    "organizations.invitation_created": (event) => {
      const payload = OUTBOX_TOPICS["organizations.invitation_created"].parse(event.payload);
      return sendIn(event, (tx) => invitationMail(tx, event, payload, { appUrl, linkSecret }));
    },
    "organizations.tenant_opened": (event) => {
      const payload = OUTBOX_TOPICS["organizations.tenant_opened"].parse(event.payload);
      return sendIn(event, (tx) => tenantOpenedMail(tx, event, payload, appUrl));
    },
    "legal.change_notified": (event) => {
      const payload = OUTBOX_TOPICS["legal.change_notified"].parse(event.payload);
      return sendIn(event, (tx) => legalChangeMail(tx, event, payload, appUrl));
    },
    "growth.pre_registration_received": (event) => {
      const payload = OUTBOX_TOPICS["growth.pre_registration_received"].parse(event.payload);
      return sendIn(event, (tx) => preRegistrationConfirmMail(tx, event, payload, publicSite));
    },
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

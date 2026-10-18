import nodemailer from "nodemailer";
import type { Logger } from "../logger.ts";

// ─────────────────────────────────────────────────────────────────────────────
// メールを送る部品。**アプリは SMTP でしか送らない**(SES の SDK を直接呼ばない。docs/guides/mail.md)。
//
//   本番 … API → Postfix(ECS・送り待ちは EFS)→ SES
//   手元 … API → Postfix(docker compose)→ Mailpit(http://localhost:8025 で見る)
//
// ここは「Postfix に渡す」まで。渡せなければ投げる → アウトボックスがやり直す(ADR 0006)。
// だから、メールは必ずアウトボックス経由で送る(リクエストの中で直接送らない。送り漏れ・二重送りの元)。
// ─────────────────────────────────────────────────────────────────────────────

export type MailMessage = {
  to: string;
  subject: string;
  /** 本文(プレーンテキスト)。HTML のメールは次の一歩 */
  text: string;
  /** 同じ出来事から作ったメールは同じ ID(受け手側で重なりに気づける) */
  messageId: string;
};

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export type MailSettings = { smtpUrl: string; from: string } | { smtpUrl: null; from: string };

/** 件名に改行が入ると、ヘッダーを足されうる(ヘッダーの注入)。1行にそろえる */
const oneLine = (s: string) => s.replace(/[\r\n\t]+/g, " ").trim();

export function createMailer(settings: MailSettings, logger: Logger): Mailer {
  if (settings.smtpUrl === null) {
    // 手元・テスト・プレビューで SMTP を置いていないとき。送らずに記録だけ(宛先や本文は書かない)
    return {
      async send(message) {
        logger.info(
          { messageId: message.messageId },
          "メールを送る代わりに記録しました(MAIL_SMTP_URL が無い)",
        );
      },
    };
  }
  const url = new URL(settings.smtpUrl);
  const transport = nodemailer.createTransport({
    host: url.hostname,
    port: Number(url.port || 25),
    secure: url.protocol === "smtps:",
    // Postfix が受け取るのを待つ時間。詰まったらアウトボックスの次のやり直しに任せる
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
  });
  return {
    async send(message) {
      await transport.sendMail({
        from: settings.from,
        to: message.to,
        subject: oneLine(message.subject),
        text: message.text,
        messageId: message.messageId,
      });
    },
  };
}

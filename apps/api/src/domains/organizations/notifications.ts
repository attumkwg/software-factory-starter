import { and, eq } from "drizzle-orm";
import type { TenantTx } from "../../db/client.ts";
import type { MailMessage } from "../../mail/index.ts";
import type { OutboxEvent, OutboxPayload } from "../../outbox/index.ts";
import { findContact } from "./repository.ts";
import { emailChanges } from "./schema.ts";

// 本人へのお知らせ(docs/specs/0006-account-security.md)。乗っ取りに本人が気づける唯一の道。
// アウトボックスの受け手(outbox/handlers.ts)が、送る直前にここで宛先と本文を組み立てる(出来事の中身は ID だけ)。

export type NoMail = { skip: string };

export type AccountNotice =
  | "organizations.password_changed"
  | "organizations.mfa_enabled"
  | "organizations.mfa_disabled";

const NOTICES: Record<AccountNotice, { subject: string; body: string; warn: boolean }> = {
  "organizations.password_changed": {
    subject: "パスワードが変更されました",
    body: "あなたのアカウントのパスワードが変更されました。",
    warn: true,
  },
  "organizations.mfa_enabled": {
    subject: "二段階認証を設定しました",
    body: "あなたのアカウントで、二段階認証(認証アプリのコード)が有効になりました。",
    warn: true,
  },
  "organizations.mfa_disabled": {
    subject: "二段階認証が外されました",
    body: "あなたのアカウントで、二段階認証(認証アプリのコード)が外されました。",
    warn: true,
  },
};

const WARNING = [
  "心当たりが無い場合は、すぐにログイン画面の「パスワードを忘れた」からパスワードを再設定し、",
  "組織の管理者に連絡してください。",
];

const messageId = (kind: string, event: OutboxEvent, appUrl: string) =>
  // 同じ出来事から作ったメールは同じ ID(アウトボックスは、まれに同じ出来事を2回届ける)
  `<${kind}.${event.id}@${new URL(appUrl).hostname}>`;

/** パスワード・二段階認証のお知らせ。宛先は本人のいまのアドレス */
export async function accountNoticeMail(
  tx: TenantTx,
  event: OutboxEvent & { topic: AccountNotice },
  payload: { userId: string },
  appUrl: string,
): Promise<MailMessage | NoMail> {
  const user = await findContact(tx, event.tenantId, payload.userId);
  if (!user) return { skip: "user_deleted" };
  const notice = NOTICES[event.topic];
  return {
    to: user.email,
    subject: notice.subject,
    text: [`${user.name} さん`, "", notice.body, "", ...WARNING, "", `${appUrl}/account`].join(
      "\n",
    ),
    messageId: messageId(event.topic.replace("organizations.", ""), event, appUrl),
  };
}

/** メールアドレスが変わった、を**古いアドレス**へ。新しいアドレスは一部を伏せる(古いアドレスが他人の手にあるかもしれない) */
export async function emailChangedMail(
  tx: TenantTx,
  event: OutboxEvent,
  payload: OutboxPayload<"organizations.email_changed">,
  appUrl: string,
): Promise<MailMessage | NoMail> {
  const [change] = await tx
    .select({
      userId: emailChanges.userId,
      previousEmail: emailChanges.previousEmail,
      newEmail: emailChanges.newEmail,
    })
    .from(emailChanges)
    .where(
      and(eq(emailChanges.tenantId, event.tenantId), eq(emailChanges.id, payload.emailChangeId)),
    );
  if (!change) return { skip: "email_change_deleted" };
  const user = await findContact(tx, event.tenantId, change.userId);
  if (!user) return { skip: "user_deleted" };
  return {
    to: change.previousEmail,
    subject: "メールアドレスが変更されました",
    text: [
      `${user.name} さん`,
      "",
      `あなたのアカウントのメールアドレスが ${maskEmail(change.newEmail)} に変更されました。`,
      "これからのお知らせは、新しいアドレスに届きます。",
      "",
      "心当たりが無い場合は、組織の管理者にすぐ連絡してください。",
    ].join("\n"),
    messageId: messageId("email-changed", event, appUrl),
  };
}

/** a***@e***.com の形に伏せる(先頭の1文字と、ドメインの最後の部分だけ残す) */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const tld = domain.includes(".") ? domain.slice(domain.lastIndexOf(".")) : "";
  return `${local.slice(0, 1)}***@${domain.slice(0, 1)}***${tld}`;
}

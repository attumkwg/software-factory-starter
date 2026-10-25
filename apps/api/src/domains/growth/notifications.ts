import { PRE_REGISTRATION_RETENTION_DAYS, PRODUCT_NAME } from "@app/shared";
import type { TenantTx } from "../../db/client.ts";
import type { MailMessage } from "../../mail/index.ts";
import type { OutboxEvent, OutboxPayload } from "../../outbox/index.ts";
import { makeLinkToken } from "./links.ts";
import { findForConfirmMail } from "./repository.ts";

// 事前登録の確認のメール(設計書 0025 の 5)。公開の入口が積んだ出来事を、アウトボックスの受け手
// (outbox/handlers.ts)が送る直前にここで組み立てる(出来事の中身は登録の ID だけ。宛先はここで読む)。
// リンクは公開のページ(apps/site)の /confirm・/withdraw の # の後ろに token を付けた物。

export type NoMail = { skip: string };

/** 公開のページの URL・リンクの鍵・プライバシーポリシーの URL(画面の /legal/privacy)。無ければ公開の入口ごと使わない */
export type PublicSiteLinks = { url: string; key: Buffer; privacyUrl: string };

export async function preRegistrationConfirmMail(
  tx: TenantTx,
  event: OutboxEvent,
  payload: OutboxPayload<"growth.pre_registration_received">,
  site: PublicSiteLinks | null,
): Promise<MailMessage | NoMail> {
  if (!site) return { skip: "public_site_not_configured" };
  const row = await findForConfirmMail({ tx, tenantId: event.tenantId }, payload.preRegistrationId);
  if (!row) return { skip: "pre_registration_deleted" };
  if (row.status !== "pending") return { skip: "already_confirmed" };
  const confirm = makeLinkToken(site.key, "confirm", row.id, row.confirmSentAt);
  const withdraw = makeLinkToken(site.key, "withdraw", row.id, row.createdAt);
  return {
    to: row.email,
    subject: `${PRODUCT_NAME}の事前登録の確認`,
    text: [
      `${PRODUCT_NAME}の事前登録をありがとうございます。`,
      "",
      "下のリンクを開いて、登録を確かめてください。確かめるまで、ご案内はお送りしません。",
      `${site.url}/confirm#t=${confirm}`,
      `(リンクの期限は${PRE_REGISTRATION_RETENTION_DAYS.pending}日です。確かめなかった登録は消えます)`,
      "",
      "お心当たりが無い場合は、このメールを捨ててください。登録を消すときは、次のリンクから:",
      `${site.url}/withdraw#t=${withdraw}`,
      "",
      `ご入力いただいた会社名とメールアドレスは、${PRODUCT_NAME}の提供開始のご案内と、試しの利用のご招待にだけ使います。`,
      `詳しくはプライバシーポリシーをご覧ください: ${site.privacyUrl}`,
    ].join("\n"),
    // 同じ確認(同じ時刻に積んだ物)から作ったメールは同じ ID(アウトボックスは、まれに同じ出来事を2回届ける)
    messageId: `<growth.${row.id}.${row.confirmSentAt.getTime()}@${new URL(site.url).hostname}>`,
  };
}

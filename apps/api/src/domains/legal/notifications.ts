import { LEGAL_DOCUMENT_TITLES, LEGAL_VERSIONS, LegalDocumentSchema } from "@app/shared";
import { and, eq } from "drizzle-orm";
import type { TenantTx } from "../../db/client.ts";
import type { MailMessage } from "../../mail/index.ts";
import type { OutboxEvent, OutboxPayload } from "../../outbox/index.ts";
import { findContact, findTimeZone } from "../organizations/index.ts";
import { notices } from "./schema.ts";

// 規約の変更のお知らせ(docs/specs/0009-legal-consent.md)。運営のコマンド legal-notify が積んだ出来事を、
// アウトボックスの受け手(outbox/handlers.ts)が送る直前にここで組み立てる(出来事の中身はお知らせの ID だけ)。

export type NoMail = { skip: string };

/** 組織の時間帯での日時(「2026年11月1日 0:00」) */
const formatAt = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("ja-JP", { timeZone, dateStyle: "long", timeStyle: "short" }).format(
    new Date(iso),
  );

export async function legalChangeMail(
  tx: TenantTx,
  event: OutboxEvent,
  payload: OutboxPayload<"legal.change_notified">,
  appUrl: string,
): Promise<MailMessage | NoMail> {
  const [notice] = await tx
    .select()
    .from(notices)
    .where(and(eq(notices.tenantId, event.tenantId), eq(notices.id, payload.noticeId)));
  if (!notice) return { skip: "notice_deleted" };
  const document = LegalDocumentSchema.safeParse(notice.document);
  const version = LEGAL_VERSIONS.find(
    (v) => document.success && v.document === document.data && v.version === notice.version,
  );
  if (!document.success || !version) return { skip: "version_unknown" };
  const user = await findContact(tx, event.tenantId, notice.userId);
  if (!user) return { skip: "user_deleted" };
  const timeZone = (await findTimeZone(tx, event.tenantId)) ?? "Asia/Tokyo";

  const title = LEGAL_DOCUMENT_TITLES[document.data];
  const effective = formatAt(version.effectiveAt, timeZone);
  const reconsent = version.reconsent
    ? [
        "この変更には、あらためての同意をお願いしています。",
        "効力の日のあと、最初にお使いになるときに同意の画面が出ます(ログインした後の画面の上の案内から、前もって同意することもできます)。",
      ]
    : ["この変更に、お手続きは要りません。効力の日から変更後の内容が適用されます。"];
  return {
    to: user.email,
    subject: `${title}を ${effective} に変更します`,
    text: [
      `${user.name} さん`,
      "",
      `${title}を変更します。変更後の内容は ${effective} から効力を生じます。`,
      "",
      `変更の要約: ${version.summary}`,
      "",
      ...reconsent,
      "",
      `変更後の${title}: ${appUrl}/legal/${document.data}/${version.version}`,
    ].join("\n"),
    // 同じお知らせから作ったメールは同じ ID(アウトボックスは、まれに同じ出来事を2回届ける)
    messageId: `<legal.${notice.id}@${new URL(appUrl).hostname}>`,
  };
}

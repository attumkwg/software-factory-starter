// メール(共通の仕組み)の入口。送るのはアウトボックスの受け手だけ(outbox/handlers.ts)。
export { createMailer, type Mailer, type MailMessage, type MailSettings } from "./mailer.ts";

// 領域「集客」の入口(公開の LP の事前登録と、来た所ごとの数。docs/specs/0025-public-landing-page.md)。
// ほかの領域・共通部分からは、ここに出した物だけを使う。運営の組織の文脈(withTenant)を開く入口とコマンドは src/pre-registrations。
export { linkKey } from "./links.ts";
export { type PublicSiteLinks, preRegistrationConfirmMail } from "./notifications.ts";
export {
  countsBySource,
  deleteByEmail,
  loadPreRegistrationForTenant,
  markPreRegistrationConverted,
  type PreRegistrationForTenant,
  purgeExpired,
  type SourceCounts,
} from "./operator.ts";
export {
  confirmPreRegistration,
  countView,
  type PublicScope,
  registerPreRegistration,
  tokyoDay,
  withdrawPreRegistration,
} from "./repository.ts";

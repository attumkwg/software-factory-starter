// 領域「集客」の入口(公開の LP の事前登録と、来た所ごとの数。docs/specs/0025-public-landing-page.md)。
// ほかの領域・共通部分からは、ここに出した物だけを使う。
export {
  loadPreRegistrationForTenant,
  markPreRegistrationConverted,
  type PreRegistrationForTenant,
  runDelete as runPreRegistrationDelete,
  runPurge as runPreRegistrationPurge,
  runReport as runPreRegistrationReport,
} from "./command.ts";
export { linkKey } from "./links.ts";
export { type PublicSiteLinks, preRegistrationConfirmMail } from "./notifications.ts";
export { type PublicGrowthDeps, publicGrowthRoutes } from "./routes.ts";

// 領域「規約と同意」の公開の入口(docs/specs/0009-legal-consent.md)。ほかの領域・共通部分はここだけを使う。
export { legalChangeMail } from "./notifications.ts";
export { type NoticePlan, noticeProblem, notifyLegalChange } from "./notify.ts";
export {
  type ConsentSource,
  capacityOf,
  exportLegalConsents,
  findAcceptedVersions,
  recordConsents,
} from "./repository.ts";
export { legalRoutes } from "./routes.ts";

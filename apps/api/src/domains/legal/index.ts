// 領域「規約と同意」の公開の入口(docs/specs/0009-legal-consent.md)。ほかの領域・共通部分はここだけを使う。
export { legalChangeMail } from "./notifications.ts";
export { addNotices, countUnnotified, type LegalRef, noticeProblem } from "./notify.ts";
export {
  type ConsentSource,
  capacityOf,
  exportLegalConsentsPage,
  findAcceptedVersions,
  recordConsents,
} from "./repository.ts";
export { legalRoutes } from "./routes.ts";

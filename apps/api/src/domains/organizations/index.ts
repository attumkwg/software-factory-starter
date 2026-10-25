// 領域「組織」の公開の入口。ほかの領域・src の共通部分は、ここから export したものだけを使う
// (中のファイルを直接 import しない。test/unit/domain-boundaries.test.ts が確かめる)。
export {
  type Access,
  confirmEmailChange,
  endOtherSessions,
  exportEmailChanges,
  findAccess,
  findMfaRequired,
  findPendingEmailChange,
  getAccount,
  isEmailInUse,
  requestEmailChange,
  setMfaEnabled,
} from "./account.ts";
export { mfaRequirementRoutes } from "./mfa-requirement-routes.ts";
export {
  type AccountNotice,
  accountNoticeMail,
  emailChangedMail,
} from "./notifications.ts";
export {
  exportOrganization,
  findContact,
  findRole,
  findTimeZone,
  findUserNames,
  listUserIds,
} from "./repository.ts";
export { organizationRoutes } from "./routes.ts";
export {
  endSupportSession,
  exportSupportGrants,
  findActiveSupportSession,
  findSupportGrantByCode,
  startSupportSession,
} from "./support.ts";
export { supportGrantRoutes } from "./support-routes.ts";

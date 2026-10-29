// 書き込みの API → 監査ログの名前(「対象.動作」)と、何に対してか。
// **書き込みの API(GET 以外・ログインが要る物)を足したら、ここにも1行**。無ければ単体テスト
// (test/unit/audit-coverage.test.ts)が落ちる。記録は認可の関所(src/authz/middleware.ts)が自動で取る。
//
// 名前は画面の文(apps/web/src/messages.ts の AUDIT_ACTION_LABELS)と、お客さんが読む記録の両方で使う。
// **一度使った名前は変えない**(古い記録が読めなくなる)。

/** param … 対象の ID が入るパスの名前(省略すると `<target>Id`) */
export type AuditAction = { action: string; target: string; param?: string };

export const AUDIT_ACTIONS: Readonly<Record<string, AuditAction>> = {
  "POST /api/projects": { action: "project.create", target: "project" },
  "DELETE /api/projects/{projectId}": { action: "project.delete", target: "project" },
  "POST /api/projects/{projectId}/tasks": { action: "task.create", target: "task" },
  "PATCH /api/tasks/{taskId}": { action: "task.update", target: "task" },
  "DELETE /api/tasks/{taskId}": { action: "task.delete", target: "task" },
  // 写真・ファイル(docs/specs/0072-file-storage.md)。名前・中身・URL は残さない(details は付け先のタスクの ID だけ)
  "POST /api/tasks/{taskId}/files": { action: "file.create", target: "file" },
  "POST /api/files/{fileId}/complete": { action: "file.complete", target: "file" },
  "DELETE /api/files/{fileId}": { action: "file.delete", target: "file" },
  "POST /api/support-grants": { action: "support_grant.create", target: "support_grant" },
  "DELETE /api/support-grants/{grantId}": {
    action: "support_grant.revoke",
    target: "support_grant",
    param: "grantId",
  },
  // 社員の組織の記録(見る組織の記録は、ハンドラーが support.start で残す)
  "POST /api/support/sessions": { action: "support.start", target: "support_session" },
  "POST /api/support/end": { action: "support.end", target: "support_session" },
  // データの書き出し(対象は組織全体なので ID は無い)
  "POST /api/exports": { action: "data.export", target: "organization", param: "none" },
  // 監査ログの書き出し(段3。期間は details に入れない。いつ書き出したかはこの行の時刻)
  "POST /api/audit-events/export": {
    action: "audit.export",
    target: "organization",
    param: "none",
  },
  // 本人のアカウント(docs/specs/0006-account-security.md)。対象はいつも行為者の本人なので ID は無い
  "POST /api/account/reauth": { action: "account.reauth", target: "user", param: "none" },
  "POST /api/account/password": {
    action: "account.password_change",
    target: "user",
    param: "none",
  },
  "POST /api/account/email": {
    action: "account.email_change_request",
    target: "user",
    param: "none",
  },
  "POST /api/account/email/confirm": {
    action: "account.email_change",
    target: "user",
    param: "none",
  },
  "POST /api/account/mfa/setup": { action: "account.mfa_setup", target: "user", param: "none" },
  "POST /api/account/mfa/enable": { action: "account.mfa_enable", target: "user", param: "none" },
  "POST /api/account/mfa/disable": { action: "account.mfa_disable", target: "user", param: "none" },
  // 組織の二段階認証の必須。入れる・切るを名前で分ける(details に値を入れない決まりのまま)
  "POST /api/organization/mfa-requirement": {
    action: "organization.mfa_require",
    target: "organization",
    param: "none",
  },
  "DELETE /api/organization/mfa-requirement": {
    action: "organization.mfa_unrequire",
    target: "organization",
    param: "none",
  },
  // 組織の「タスクが完了したメール」(docs/specs/0093-task-mail-switch.md)。止める・戻すを名前で分ける
  "POST /api/organization/task-mail": {
    action: "organization.task_mail_on",
    target: "organization",
    param: "none",
  },
  "DELETE /api/organization/task-mail": {
    action: "organization.task_mail_off",
    target: "organization",
    param: "none",
  },
  // 利用規約・プライバシーポリシーへの同意(docs/specs/0009-legal-consent.md)。どの版かは legal.consents の行
  "POST /api/legal/consents": { action: "legal.consent", target: "user", param: "none" },
  // 招待(docs/specs/0027-invitations.md)。メールアドレス・ロールは details に入れない(招待の行にある)
  "POST /api/invitations": { action: "invitation.create", target: "invitation" },
  // 大きなお客さん向けの守り(docs/specs/0056-sso-scim-ip-audit-export.md)。ドメイン・IP の値は details に入れない(行にある)
  "POST /api/organization/domains": { action: "domain.create", target: "domain" },
  "POST /api/organization/domains/{domainId}/verify": { action: "domain.verify", target: "domain" },
  "DELETE /api/organization/domains/{domainId}": { action: "domain.delete", target: "domain" },
  "PUT /api/organization/sso": { action: "sso.update", target: "organization", param: "none" },
  "PUT /api/organization/ip-allowlist": {
    action: "ip_allowlist.update",
    target: "organization",
    param: "none",
  },
  // SCIM の鍵(段2)。鍵そのものもハッシュも details に入れない
  "POST /api/organization/scim-tokens": { action: "scim_token.create", target: "scim_token" },
  "DELETE /api/organization/scim-tokens/{tokenId}": {
    action: "scim_token.revoke",
    target: "scim_token",
    param: "tokenId",
  },
  "POST /api/organization/members/{memberId}/sign-out": {
    action: "member.sign_out",
    target: "member",
  },
  // 止める・戻す・ロールを変える(docs/specs/0079-member-admin.md)。変えた先のロールは details に入れない(値を入れない決まり。いまのロールは組織の人の一覧)
  "PUT /api/organization/members/{memberId}/role": {
    action: "member.role_change",
    target: "member",
  },
  "POST /api/organization/members/{memberId}/disable": {
    action: "member.disable",
    target: "member",
  },
  "POST /api/organization/members/{memberId}/enable": {
    action: "member.enable",
    target: "member",
  },
  // 組織の選び直し(docs/specs/0055-multi-org-membership.md)。関所が元の組織に「出た」を残す。先の組織の「入った」はハンドラーが手で
  "POST /api/session/organization": {
    action: "auth.switch_out",
    target: "organization",
    param: "none",
  },
  "DELETE /api/invitations/{invitationId}": { action: "invitation.revoke", target: "invitation" },
  // 「無くなったら困るか」に答えた(docs/specs/0046-pmf-survey.md)。**何と答えたかは details に入れない**(数の表にだけある)
  "POST /api/pmf-survey": { action: "pmf_survey.respond", target: "user", param: "none" },
};

/** 関所の外(ログインの API など)で、手で記録する物 */
export const MANUAL_AUDIT_ACTIONS = {
  login: "auth.login",
  logout: "auth.logout",
  // 登録の確認(公開の API)のあとに、登録の画面で同意した版を記録したとき
  signUpConsent: "legal.consent",
  // 運営のコマンド feature-flag が、組織に機能を入れた・切った(docs/specs/0012-feature-flags-and-usage.md)。details.flag に名前
  featureFlagEnable: "feature_flag.enable",
  featureFlagDisable: "feature_flag.disable",
  // 運営のコマンド create-tenant が組織を作った(docs/specs/0026-tenant-provisioning.md)。
  // 作った組織と運営の組織の両方に残す。details.adminUserId に最初の管理者の ID
  tenantCreate: "tenant.create",
  // 招かれた人が、ログインの前に招待を受けた(公開の API。行為者は受けてできた人)
  invitationAccept: "invitation.accept",
  // 運営のコマンド plan・create-tenant が、組織の契約のプランを変えた(docs/specs/0047-plans.md)。
  // details.plan・details.priceList に名前(PLANS・PRICE_LISTS。人数・日付は platform.tenant_plans の行)
  planChange: "plan.change",
  // 公開の LP の事前登録(docs/specs/0025-public-landing-page.md)。運営の組織の監査ログに残す。
  // 期限で消した(details に件数)・問い合わせで消した(対象は登録の ID)・組織にした(details.convertedTenantId)・
  // メールアドレスから登録を探した(対象は見つかった登録の ID。見つからなければ残さない)
  preRegistrationPurged: "pre_registration.purged",
  preRegistrationDeleted: "pre_registration.deleted",
  preRegistrationConverted: "pre_registration.converted",
  preRegistrationFound: "pre_registration.found",
  // 組織を選び直して、この組織に入った(元の組織には関所が auth.switch_out を残す)
  switchIn: "auth.switch_in",
  // 運営のコマンド sso-connect・sso-disconnect が、組織に IdP をつないだ・外した(docs/designs/0056-sso-scim-ip-audit-export.md の 5)
  ssoConnect: "sso.connect",
  ssoDisconnect: "sso.disconnect",
  // 情シスの道具(SCIM)の操作(src/auth/scim-routes.ts。行為者は kind: scim・id は鍵の ID)。
  // 対象は人。名前・メールは details に入れない(details.fields に直した項目の名前だけ)
  scimUserCreate: "scim.user_create",
  scimUserUpdate: "scim.user_update",
  scimUserDisable: "scim.user_disable",
  scimUserEnable: "scim.user_enable",
  // 運営のコマンド demo-reset が、デモ用の組織のデータを戻した(docs/specs/0053-sales-kit.md。stg だけ)
  demoReset: "demo.reset",
  // 運営のコマンド person-data --execute が、本人の求めで1人分を消した・匿名化した(docs/specs/0089-person-erase.md)。
  // 対象はその人(member)。details に件数だけ(anonymize・delete)
  personErase: "person.erase",
} as const;

/**
 * 代理の社員が読んだ(GET)ときの名前。対象はパスの最後の `<対象>Id`(例 /api/projects/{projectId} → project)。
 * 一覧(ID が無い)は対象なしで、details の route で分かる。
 */
export function supportReadAction(openApiPath: string): AuditAction {
  const ids = [...openApiPath.matchAll(/\{([a-zA-Z]+)Id\}/g)].map((m) => m[1] as string);
  const last = ids.at(-1);
  return { action: "support.read", target: last ?? "none", param: last ? `${last}Id` : "none" };
}

export function auditActionFor(method: string, openApiPath: string): AuditAction | undefined {
  return AUDIT_ACTIONS[`${method} ${openApiPath}`];
}

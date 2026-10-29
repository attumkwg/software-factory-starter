import type { AuditEvent } from "@app/shared";

// 監査ログの画面の文(apps/api/src/audit/actions.ts の名前 → 人が読む文)。文言は自由に変えてよい。
// 名前を足したら、ここにも足す(無い名前はそのまま出る)。足し忘れは単体テスト(audit-labels.test.ts)が落ちる。

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "auth.login": "ログインした",
  "auth.logout": "ログアウトした",
  "project.create": "プロジェクトを作った",
  "project.delete": "プロジェクトを消した",
  "task.create": "タスクを作った",
  "task.update": "タスクを直した",
  "task.delete": "タスクを消した",
  "file.create": "ファイルを上げ始めた",
  "file.complete": "ファイルを上げ終えた",
  "file.delete": "ファイルを消した",
  "support_grant.create": "サポートに見せるのを許可した",
  "support_grant.revoke": "サポートへの許可を取り消した",
  "support.start": "サポートが入った",
  "support.read": "サポートが見た",
  "support.end": "サポートが出た",
  "account.reauth": "パスワードを入れ直した",
  "account.password_change": "パスワードを変えた",
  "account.email_change_request": "メールアドレスの変更を申し込んだ",
  "account.email_change": "メールアドレスを変えた",
  "account.mfa_setup": "二段階認証の設定を始めた",
  "account.mfa_enable": "二段階認証を有効にした",
  "account.mfa_disable": "二段階認証を外した",
  "organization.mfa_require": "二段階認証を全員に必須にした",
  "organization.mfa_unrequire": "二段階認証の必須を切った",
  "organization.task_mail_on": "タスクが完了したメールを送るに戻した",
  "organization.task_mail_off": "タスクが完了したメールを止めた",
  "legal.consent": "利用規約などに同意した",
  "feature_flag.enable": "機能を入れた",
  "feature_flag.disable": "機能を切った",
  "tenant.create": "組織を作った",
  "invitation.create": "人を招いた",
  "invitation.revoke": "招待を取り消した",
  "invitation.accept": "招待を受けて参加した",
  "plan.change": "プランを変えた",
  "domain.create": "会社のドメインを登録した",
  "domain.verify": "会社のドメインを DNS で確かめた",
  "domain.delete": "会社のドメインを消した",
  "ip_allowlist.update": "組織に入れる IP の範囲を変えた",
  "member.sign_out": "人を強制ログアウトした",
  "member.role_change": "人のロールを変えた",
  "member.disable": "人を止めた(外した)",
  "member.enable": "止めた人を戻した",
  "scim_token.create": "SCIM の鍵を作った",
  "scim_token.revoke": "SCIM の鍵を取り消した",
  "scim.user_create": "人を作った",
  "scim.user_update": "人を直した",
  "scim.user_disable": "人を止めた",
  "scim.user_enable": "止めた人を戻した",
  "audit.export": "監査ログを書き出した",
  "data.export": "組織のデータを書き出した",
  "sso.update": "SSO の設定を変えた",
  "sso.connect": "SSO(会社の IdP)をつないだ",
  "sso.disconnect": "SSO(会社の IdP)を外した",
  // 公開の LP の事前登録(運営の組織の監査ログにだけ出る)
  "pre_registration.purged": "期限の過ぎた事前登録を消した",
  "pre_registration.deleted": "問い合わせで事前登録を消した",
  "pre_registration.converted": "事前登録から組織を作った",
  "pre_registration.found": "メールアドレスから事前登録を探した",
  "auth.switch_in": "ほかの組織からこの組織に切り替えた",
  "auth.switch_out": "この組織からほかの組織に切り替えた",
  "demo.reset": "デモのデータを戻した",
  "person.erase": "本人の求めで、その人のデータを消した",
  // 何と答えたかは記録に無い(数の表にだけある)
  "pmf_survey.respond": "「無くなったら困るか」に答えた",
};

const TARGET_LABELS: Record<string, string> = {
  project: "プロジェクト",
  task: "タスク",
  support_grant: "サポートへの許可",
  support_session: "サポートの入室",
  user: "アカウント",
  organization: "組織",
  invitation: "招待",
  domain: "ドメイン",
  member: "人",
  scim_token: "SCIM の鍵",
};
const FIELD_LABELS: Record<string, string> = {
  title: "題名",
  done: "完了",
  name: "名前",
  externalId: "道具の側の ID",
};

export function auditActionLabel(e: AuditEvent): string {
  const base = AUDIT_ACTION_LABELS[e.action] ?? e.action;
  const fields = Array.isArray(e.details.fields)
    ? (e.details.fields as unknown[]).map((f) => FIELD_LABELS[String(f)] ?? String(f))
    : [];
  if (fields.length > 0) return `${base}(${fields.join("・")})`;
  // 運営が変えたプランと価格表の版(docs/specs/0047-plans.md)
  if (typeof e.details.plan === "string") {
    return `${base}(${e.details.plan}・価格表 ${String(e.details.priceList ?? "")})`;
  }
  // 運営が入れた・切った機能の名前(docs/specs/0012-feature-flags-and-usage.md)
  return typeof e.details.flag === "string" ? `${base}(${e.details.flag})` : base;
}

export function auditActorLabel(e: AuditEvent): string {
  switch (e.actor.kind) {
    case "support":
      return "サポート(運営)";
    case "system":
      return "仕組み(自動)";
    case "scim":
      return "SCIM(情シスの道具)";
    default:
      // 消された人は名前が引けない
      return e.actor.name ?? "(いまはいない人)";
  }
}

/** 対象の種類と ID の頭(全部は長いので。問い合わせのときは requestId を使う) */
export function auditTargetLabel(e: AuditEvent): string {
  if (!e.target) return "—";
  return `${TARGET_LABELS[e.target.type] ?? e.target.type} ${e.target.id.slice(-8)}`;
}

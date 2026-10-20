import { z } from "zod";

// 本人のアカウント(二段階認証・メール・パスワード)と、組織の二段階認証の必須の取り決め
// (docs/specs/0006-account-security.md)。項目は足すだけ・消さない。

/** 認証アプリに出る名前(発行者)。雛形を使う人はここを替える(メールの差出人の名前と同じにしておく) */
export const PRODUCT_NAME = "Tasks";

const Email = z.email().max(254);
const Password = z.string().min(1).max(256);
const Code = z.string().regex(/^\d{6}$/, "数字6桁");

/** 画面「アカウント」に出す本人の状態 */
export const AccountSchema = z.object({
  email: z.email(),
  mfaEnabled: z.boolean(),
  /** メールの変更を申し込んで、まだ確認していない新しいアドレス */
  pendingEmail: z.email().nullable(),
  organizationRequiresMfa: z.boolean(),
});
export type Account = z.infer<typeof AccountSchema>;

/** パスワード(と、二段階認証が有効ならいまのコード)を入れ直す */
export const ReauthSchema = z.object({ password: Password, code: Code.optional() });
export type Reauth = z.infer<typeof ReauthSchema>;

export const ChangePasswordSchema = z.object({
  currentPassword: Password,
  newPassword: Password,
  code: Code.optional(),
});
export type ChangePassword = z.infer<typeof ChangePasswordSchema>;

export const ChangeEmailSchema = z.object({ newEmail: Email });
export type ChangeEmail = z.infer<typeof ChangeEmailSchema>;

/** 確認コード・二段階認証のコード(数字6桁) */
export const AccountCodeSchema = z.object({ code: Code });

export const DisableMfaSchema = z.object({ password: Password, code: Code });
export type DisableMfa = z.infer<typeof DisableMfaSchema>;

/** 二段階認証の鍵。secret は手で入れる鍵(base32)・otpauthUri は QR にする URI */
export const MfaSetupSchema = z.object({ secret: z.string(), otpauthUri: z.string() });
export type MfaSetup = z.infer<typeof MfaSetupSchema>;

export const EmailChangeRequestedSchema = z.object({ next: z.literal("confirm") });

/** 組織の二段階認証の必須(管理者だけ)。まだ設定していない人は数だけ(名前は出さない) */
export const MfaRequirementSchema = z.object({
  required: z.boolean(),
  usersWithoutMfa: z.number().int().nonnegative(),
});
export type MfaRequirement = z.infer<typeof MfaRequirementSchema>;

/** 認証アプリに読ませる URI(otpauth://totp/発行者:メール?secret=…) */
export function otpauthUri(email: string, secret: string, issuer = PRODUCT_NAME): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const q = (v: string) => encodeURIComponent(v);
  return `otpauth://totp/${label}?secret=${q(secret)}&issuer=${q(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

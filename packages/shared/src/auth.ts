import { z } from "zod";
import settings from "./cognito-settings.json" with { type: "json" };
import { LEGAL_DOCUMENTS, LegalVersionRefSchema } from "./legal.ts";

// ログイン・登録の画面と API の取り決め。Cognito の設定の正は cognito-settings.json(Terraform と偽物の Cognito も読む)。

export const PASSWORD_POLICY = settings.passwordPolicy;

/** パスワードの決まりを満たさない理由(画面で先に知らせる。最後に確かめるのは Cognito) */
export function passwordProblems(password: string): string[] {
  const p = PASSWORD_POLICY;
  const problems: string[] = [];
  if (password.length < p.minimumLength) problems.push(`${p.minimumLength}文字以上`);
  if (p.requireLowercase && !/[a-z]/.test(password)) problems.push("小文字を入れる");
  if (p.requireUppercase && !/[A-Z]/.test(password)) problems.push("大文字を入れる");
  if (p.requireNumbers && !/[0-9]/.test(password)) problems.push("数字を入れる");
  if (p.requireSymbols && !/[^A-Za-z0-9]/.test(password)) problems.push("記号を入れる");
  return problems;
}

/** パスワードの決まりの説明(画面の入力欄の下に出す) */
export const PASSWORD_RULES_TEXT = (() => {
  const p = PASSWORD_POLICY;
  const kinds = [
    p.requireUppercase && "大文字",
    p.requireLowercase && "小文字",
    p.requireNumbers && "数字",
    p.requireSymbols && "記号",
  ].filter(Boolean);
  return `${p.minimumLength}文字以上。${kinds.join("・")}をそれぞれ1つ以上`;
})();

const Email = z.email().max(254);
// 長さの上限だけ。中身の決まりは Cognito が確かめる(ここで弾くのは長すぎる入力だけ)
const Password = z.string().min(1).max(256);
// 確認コード・二段階認証のコード(数字6桁)
const Code = z.string().regex(/^\d{6}$/, "数字6桁");

export const LoginSchema = z.object({ email: Email, password: Password });
export const SignUpSchema = z.object({ email: Email, password: Password });
export const ConfirmSignUpSchema = z.object({
  email: Email,
  code: Code,
  /**
   * 登録の画面で同意した版(docs/specs/0009-legal-consent.md)。確認コードが通り、アプリに登録されている人なら記録する。
   * 無ければ記録しない(次のログインで同意の画面が出る)
   */
  consents: z.array(LegalVersionRefSchema).max(LEGAL_DOCUMENTS.length).optional(),
});
export const ResendCodeSchema = z.object({ email: Email });
export const MfaSchema = z.object({ code: Code });
export const ForgotPasswordSchema = z.object({ email: Email });
export const ResetPasswordSchema = z.object({ email: Email, code: Code, password: Password });

/**
 * ログイン・登録の API が返す「次にすること」。
 *   done    … ログインした(Cookie を返した)
 *   mfa     … 二段階認証のコードを入れる
 *   confirm … メールの確認コードを入れる(登録の途中)
 *   login   … ログインし直す(登録の確認・パスワードの再設定が終わった)
 */
export const AuthNextSchema = z.object({ next: z.enum(["done", "mfa", "confirm", "login"]) });
export type AuthNext = z.infer<typeof AuthNextSchema>;

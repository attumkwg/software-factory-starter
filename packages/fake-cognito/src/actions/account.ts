import { type Body, CognitoFault, type UserPool } from "../pool.ts";

// ログインした本人の操作(アクセストークンで呼ぶ): 状態を読む・パスワードの変更・メールの変更・全部のトークンを無効に
// (GetUser・ChangePassword・UpdateUserAttributes・VerifyUserAttribute・GlobalSignOut)。
// アプリの使い方は docs/designs/0006-account-security.md の 5。本物と同じかは contract/account.contract.test.ts。

/** 本物は、二段階認証が1つも無い人には UserMFASettingList を返さない */
export function getUser(pool: UserPool, b: Body) {
  const user = pool.byAccessToken(b);
  const mfa = user.totp?.enabled ? ["SOFTWARE_TOKEN_MFA"] : [];
  return {
    Username: user.sub,
    UserAttributes: [
      { Name: "sub", Value: user.sub },
      { Name: "email", Value: user.email },
      { Name: "email_verified", Value: String(user.emailVerified) },
    ],
    ...(mfa.length > 0 ? { UserMFASettingList: mfa, PreferredMfaSetting: mfa[0] } : {}),
  };
}

export function changePassword(pool: UserPool, b: Body) {
  const user = pool.byAccessToken(b);
  if (user.password !== b.PreviousPassword) {
    throw new CognitoFault("NotAuthorizedException", "Incorrect username or password.");
  }
  user.password = pool.checkPassword(b.ProposedPassword);
  return {};
}

/**
 * メールの変更の申し込み。プールの設定(確認するまでは古いメールのまま)と同じく、ここではまだ替えず、
 * 新しいメールに確認コードを送る。ほかの人が使っているメールなら AliasExistsException
 * (本物が申し込みの時点で断るか、確認の時点で断るかは契約テストが確かめる。アプリはどちらでも同じ答え)。
 */
export async function updateUserAttributes(pool: UserPool, b: Body) {
  const user = pool.byAccessToken(b);
  const attrs = (Array.isArray(b.UserAttributes) ? b.UserAttributes : []) as Body[];
  const email = attrs.find((a) => a.Name === "email")?.Value;
  if (typeof email !== "string" || attrs.length !== 1) {
    throw new CognitoFault("InvalidParameterException", "偽物の Cognito は email の変更だけです");
  }
  const next = email.toLowerCase();
  if (next !== user.email && pool.find(next)) {
    throw new CognitoFault(
      "AliasExistsException",
      "An account with the given email already exists.",
    );
  }
  user.pendingEmail = next;
  return { CodeDeliveryDetailsList: [await pool.sendCode(user, "verify_email", next)] };
}

export function verifyUserAttribute(pool: UserPool, b: Body) {
  const user = pool.byAccessToken(b);
  if (b.AttributeName !== "email") {
    throw new CognitoFault("InvalidParameterException", "偽物の Cognito は email の確認だけです");
  }
  pool.useCode(user.pendingEmail ? user : undefined, b.Code, "verify_email");
  const next = user.pendingEmail as string;
  if (pool.find(next) && next !== user.email) {
    throw new CognitoFault(
      "AliasExistsException",
      "An account with the given email already exists.",
    );
  }
  pool.rename(user, next);
  user.pendingEmail = undefined;
  user.emailVerified = true;
  return {};
}

/** その人のアクセストークンを全部無効にする(アプリは変更を終えたら呼ぶ) */
export function globalSignOut(pool: UserPool, b: Body) {
  const user = pool.byAccessToken(b);
  for (const [token, t] of pool.accessTokens) {
    if (t.username === user.email) pool.accessTokens.delete(token);
  }
  return {};
}

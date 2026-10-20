import settings from "../../../shared/src/cognito-settings.json" with { type: "json" };
import { type Body, CognitoFault, type User, type UserPool } from "../pool.ts";

// 管理の入口(AdminConfirmSignUp・AdminDeleteUser・AdminGetUser・DescribeUserPool)。署名は確かめない

function mustFind(pool: UserPool, b: Body): User {
  pool.requirePool(b);
  const user = pool.find(b.Username);
  if (!user) throw new CognitoFault("UserNotFoundException", "User does not exist.");
  return user;
}

export function adminConfirmSignUp(pool: UserPool, b: Body) {
  const user = mustFind(pool, b);
  // 本物と同じく、管理の確認ではメールは「確認済み」にならない
  // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_username -- 状態の名前で、ユーザー名ではない
  user.status = "CONFIRMED";
  return {};
}

export function adminDeleteUser(pool: UserPool, b: Body) {
  const user = mustFind(pool, b);
  pool.users.delete(user.email);
  return {};
}

export function adminGetUser(pool: UserPool, b: Body) {
  const user = mustFind(pool, b);
  return {
    Username: user.sub,
    UserStatus: user.status,
    Enabled: true,
    UserAttributes: [
      { Name: "sub", Value: user.sub },
      { Name: "email", Value: user.email },
      { Name: "email_verified", Value: String(user.emailVerified) },
    ],
    PreferredMfaSetting: user.totp?.enabled ? "SOFTWARE_TOKEN_MFA" : undefined,
  };
}

export function describeUserPool(pool: UserPool, b: Body) {
  pool.requirePool(b);
  const p = settings.passwordPolicy;
  return {
    UserPool: {
      Id: pool.id,
      MfaConfiguration: "OPTIONAL",
      UsernameAttributes: ["email"],
      Policies: {
        PasswordPolicy: {
          MinimumLength: p.minimumLength,
          RequireLowercase: p.requireLowercase,
          RequireUppercase: p.requireUppercase,
          RequireNumbers: p.requireNumbers,
          RequireSymbols: p.requireSymbols,
          TemporaryPasswordValidityDays: p.temporaryPasswordValidityDays,
        },
      },
      VerificationMessageTemplate: {
        EmailSubject: settings.verificationEmail.subject,
        EmailMessage: settings.verificationEmail.message,
        DefaultEmailOption: "CONFIRM_WITH_CODE",
      },
    },
  };
}

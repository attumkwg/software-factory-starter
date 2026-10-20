import { randomBytes } from "node:crypto";
import { type Body, b64url, CognitoFault, type UserPool } from "../pool.ts";
import { newTotpSecret } from "../totp.ts";

// ログイン(InitiateAuth・RespondToAuthChallenge)と二段階認証の設定
// (AssociateSoftwareToken・VerifySoftwareToken・SetUserMFAPreference)

const SESSION_TTL_MS = 3 * 60 * 1000;
/** 本物の Cognito も、続けて間違えると一時的に止める(回数と時間は公開されていないので、だいたい) */
const MAX_FAILURES = 5;
const LOCK_MS = 60 * 1000;

export function initiateAuth(pool: UserPool, b: Body) {
  pool.requireClient(b);
  if (b.AuthFlow !== "USER_PASSWORD_AUTH") {
    throw new CognitoFault(
      "InvalidParameterException",
      "偽物の Cognito は USER_PASSWORD_AUTH だけです",
    );
  }
  const params = (b.AuthParameters ?? {}) as Record<string, unknown>;
  const user = pool.find(params.USERNAME);
  const wrong = () => new CognitoFault("NotAuthorizedException", "Incorrect username or password.");
  if (!user) throw wrong();
  if (user.lockedUntil > pool.now())
    throw new CognitoFault("NotAuthorizedException", "Password attempts exceeded");
  if (user.password !== params.PASSWORD) {
    user.failures += 1;
    if (user.failures >= MAX_FAILURES) {
      user.failures = 0;
      user.lockedUntil = pool.now() + LOCK_MS;
      throw new CognitoFault("NotAuthorizedException", "Password attempts exceeded");
    }
    throw wrong();
  }
  user.failures = 0;
  if (user.status !== "CONFIRMED")
    throw new CognitoFault("UserNotConfirmedException", "User is not confirmed.");
  if (user.totp?.enabled) {
    const session = b64url(randomBytes(48));
    pool.sessions.set(session, { username: user.email, expiresAt: pool.now() + SESSION_TTL_MS });
    return { ChallengeName: "SOFTWARE_TOKEN_MFA", Session: session, ChallengeParameters: {} };
  }
  return { AuthenticationResult: pool.tokens(user), ChallengeParameters: {} };
}

export function respondToChallenge(pool: UserPool, b: Body) {
  pool.requireClient(b);
  if (b.ChallengeName !== "SOFTWARE_TOKEN_MFA") {
    throw new CognitoFault(
      "InvalidParameterException",
      "偽物の Cognito は SOFTWARE_TOKEN_MFA だけです",
    );
  }
  const session = pool.sessions.get(String(b.Session ?? ""));
  const responses = (b.ChallengeResponses ?? {}) as Record<string, unknown>;
  const user = pool.find(responses.USERNAME);
  if (!session || session.expiresAt < pool.now() || !user || session.username !== user.email) {
    throw new CognitoFault(
      "NotAuthorizedException",
      "Invalid session for the user, session is expired.",
    );
  }
  if (!user.totp || !pool.totpMatches(user.totp.secret, responses.SOFTWARE_TOKEN_MFA_CODE)) {
    // 間違えたら、この札はもう使えない(パスワードからやり直す)。本物も同じかは契約テストが確かめる
    pool.sessions.delete(String(b.Session));
    throw new CognitoFault("CodeMismatchException", "Invalid code received for user");
  }
  pool.sessions.delete(String(b.Session));
  return { AuthenticationResult: pool.tokens(user), ChallengeParameters: {} };
}

export function associateSoftwareToken(pool: UserPool, b: Body) {
  const user = pool.byAccessToken(b);
  const secret = newTotpSecret();
  user.totp = { secret, verified: false, enabled: false };
  return { SecretCode: secret };
}

export function verifySoftwareToken(pool: UserPool, b: Body) {
  const user = pool.byAccessToken(b);
  if (!user.totp || !pool.totpMatches(user.totp.secret, b.UserCode)) {
    throw new CognitoFault("EnableSoftwareTokenMFAException", "Code mismatch");
  }
  user.totp.verified = true;
  return { Status: "SUCCESS" };
}

export function setMfaPreference(pool: UserPool, b: Body) {
  const user = pool.byAccessToken(b);
  const s = (b.SoftwareTokenMfaSettings ?? {}) as Record<string, unknown>;
  if (s.Enabled === true && !user.totp?.verified) {
    throw new CognitoFault("InvalidParameterException", "User has not verified software token mfa");
  }
  if (user.totp) user.totp.enabled = s.Enabled === true;
  return {};
}

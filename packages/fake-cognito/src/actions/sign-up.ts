import { type Body, CognitoFault, delivery, fakeSub, type User, type UserPool } from "../pool.ts";

// 登録(SignUp・ConfirmSignUp・ResendConfirmationCode)と再設定(ForgotPassword・ConfirmForgotPassword)

export async function signUp(pool: UserPool, b: Body) {
  pool.requireClient(b);
  const username = String(b.Username ?? "").toLowerCase();
  if (!username.includes("@"))
    throw new CognitoFault("InvalidParameterException", "Username should be an email.");
  if (pool.users.has(username))
    throw new CognitoFault(
      "UsernameExistsException",
      "An account with the given email already exists.",
    );
  const password = pool.checkPassword(b.Password);
  const user: User = {
    sub: fakeSub(username),
    email: username,
    password,
    status: "UNCONFIRMED",
    emailVerified: false,
    failures: 0,
    lockedUntil: 0,
  };
  pool.users.set(username, user);
  const sent = await pool.sendCode(user, "sign_up");
  return { UserConfirmed: false, UserSub: user.sub, CodeDeliveryDetails: sent };
}

export function confirmSignUp(pool: UserPool, b: Body) {
  pool.requireClient(b);
  const user = pool.find(b.Username);
  if (user?.status === "CONFIRMED") {
    throw new CognitoFault(
      "NotAuthorizedException",
      "User cannot be confirmed. Current status is CONFIRMED",
    );
  }
  pool.useCode(user, b.ConfirmationCode, "sign_up");
  if (user) {
    // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_username -- 状態の名前で、ユーザー名ではない
    user.status = "CONFIRMED";
    user.emailVerified = true;
  }
  return {};
}

export async function resendCode(pool: UserPool, b: Body) {
  pool.requireClient(b);
  const user = pool.find(b.Username);
  if (user?.status === "CONFIRMED")
    throw new CognitoFault("InvalidParameterException", "User is already confirmed.");
  // いない人にも、送ったような答え(prevent_user_existence_errors)
  if (!user) return { CodeDeliveryDetails: delivery(String(b.Username)) };
  return { CodeDeliveryDetails: await pool.sendCode(user, "sign_up") };
}

export async function forgotPassword(pool: UserPool, b: Body) {
  pool.requireClient(b);
  const user = pool.find(b.Username);
  // いない人・確認がまだの人にも、送ったような答え(prevent_user_existence_errors)
  if (user?.status !== "CONFIRMED") return { CodeDeliveryDetails: delivery(String(b.Username)) };
  return { CodeDeliveryDetails: await pool.sendCode(user, "reset") };
}

export function confirmForgotPassword(pool: UserPool, b: Body) {
  pool.requireClient(b);
  const user = pool.find(b.Username);
  const password = pool.checkPassword(b.Password);
  pool.useCode(user, b.ConfirmationCode, "reset");
  if (user) {
    user.password = password;
    user.failures = 0;
    user.lockedUntil = 0;
  }
  return {};
}

import {
  createHash,
  createHmac,
  generateKeyPairSync,
  type KeyObject,
  randomBytes,
  randomInt,
  randomUUID,
  sign,
} from "node:crypto";
import settings from "../../shared/src/cognito-settings.json" with { type: "json" };
import { type SendMail, sendMailViaSmtp } from "./smtp.ts";

// ─────────────────────────────────────────────────────────────────────────────
// 開発とテスト専用の「偽物の Cognito」。本物の Cognito の API(JSON 1.1・x-amz-target)と同じ形で答える。
// **アプリ(apps/api/src/auth/providers.ts)が使う入口と、契約テストが使う管理の入口だけ**を持つ。
//
//   登録     … SignUp・ConfirmSignUp・ResendConfirmationCode
//   ログイン … InitiateAuth(USER_PASSWORD_AUTH)・RespondToAuthChallenge(SOFTWARE_TOKEN_MFA)
//   再設定   … ForgotPassword・ConfirmForgotPassword
//   二段階   … AssociateSoftwareToken・VerifySoftwareToken・SetUserMFAPreference
//   管理     … AdminConfirmSignUp・AdminDeleteUser・AdminGetUser・DescribeUserPool(署名は確かめない)
//   公開鍵   … GET /<プール>/.well-known/jwks.json
//
// 本物と同じく断る(決まりを満たさないパスワード・違うコード・その人がいない・試しすぎ)。
// 「本物と同じか」は契約テスト(contract/)が本物と偽物の両方に同じテストを流して確かめる。偽物の振る舞いを
// 変えたら契約テストも直し、stg の本物で通ることを確かめる。設定は cognito-settings.json(Terraform も読む)。
// **本番では使わない**。
// ─────────────────────────────────────────────────────────────────────────────

export type FakeCognitoOptions = {
  /** API から届く、この偽物の URL(例: http://fake-cognito:9231)。発行元は `${baseUrl}/${userPoolId}` */
  baseUrl: string;
  userPoolId?: string;
  clientId: string;
  /** 確認コードのメールを送る。無ければ送らずに覚えておくだけ(テストは lastCode で読む) */
  sendMail?: SendMail;
  /** テスト用: 時計 */
  now?: () => number;
};

type User = {
  sub: string;
  email: string;
  password: string;
  status: "UNCONFIRMED" | "CONFIRMED";
  emailVerified: boolean;
  code?: { value: string; purpose: "sign_up" | "reset"; expiresAt: number };
  totp?: { secret: string; verified: boolean; enabled: boolean };
  failures: number;
  lockedUntil: number;
};

class CognitoFault extends Error {
  readonly type: string;
  constructor(type: string, message: string) {
    super(message);
    this.type = type;
  }
}

const SIGN_UP_CODE_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_CODE_TTL_MS = 60 * 60 * 1000;
const SESSION_TTL_MS = 3 * 60 * 1000;
const TOKEN_TTL_S = 60 * 60;
/** 本物の Cognito も、続けて間違えると一時的に止める(回数と時間は公開されていないので、だいたい) */
const MAX_FAILURES = 5;
const LOCK_MS = 60 * 1000;

const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** 同じメールなら毎回同じ sub(本物の Cognito も、人ごとに変わらない ID を返す) */
export function fakeSub(email: string): string {
  const h = createHash("sha256").update(email.toLowerCase()).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function base32Decode(s: string): Buffer {
  let bits = "";
  for (const ch of s.replace(/=+$/, "").toUpperCase()) {
    const i = BASE32.indexOf(ch);
    if (i >= 0) bits += i.toString(2).padStart(5, "0");
  }
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((b) => Number.parseInt(b, 2)));
}

/** 二段階認証のコード(TOTP。RFC 6238・SHA-1・30秒・6桁)。テストと契約テストからも使う */
export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = (h[h.length - 1] ?? 0) & 0xf;
  const n = (h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return n.toString().padStart(6, "0");
}

/** 本物と同じ形で、宛先を伏せる(a***@e***) */
const mask = (email: string) => {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain.slice(0, 1)}***`;
};

export class FakeCognito {
  readonly issuer: string;
  readonly #opts: FakeCognitoOptions;
  readonly #poolId: string;
  readonly #privateKey: KeyObject;
  readonly #jwk: Record<string, unknown>;
  readonly #users = new Map<string, User>();
  readonly #sessions = new Map<string, { username: string; expiresAt: number }>();
  readonly #accessTokens = new Map<string, string>();
  readonly #sent: { to: string; subject: string; text: string; code: string }[] = [];

  constructor(opts: FakeCognitoOptions) {
    this.#opts = opts;
    this.#poolId = opts.userPoolId ?? "local_fakepool";
    this.issuer = `${opts.baseUrl}/${this.#poolId}`;
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    this.#privateKey = privateKey;
    this.#jwk = { ...publicKey.export({ format: "jwk" }), kid: "fake-1", alg: "RS256", use: "sig" };
  }

  /** 公開鍵(テストでは createLocalJWKSet に渡す) */
  get jwks(): { keys: Record<string, unknown>[] } {
    return { keys: [this.#jwk] };
  }

  /** テスト用: その人に最後に送った確認コード */
  lastCode(email: string): string | undefined {
    return this.#sent.findLast((m) => m.to === email.toLowerCase())?.code;
  }

  #now() {
    return this.#opts.now?.() ?? Date.now();
  }

  /** Web 標準の Request → Response(テストからはこれを直接呼ぶ) */
  fetch = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === `/${this.#poolId}/.well-known/jwks.json`) {
      return Response.json(this.jwks);
    }
    if (req.method === "GET" && url.pathname === "/healthz") return new Response("ok");
    const target = req.headers.get("x-amz-target") ?? "";
    if (req.method !== "POST" || !target.startsWith("AWSCognitoIdentityProviderService.")) {
      return new Response("not found", { status: 404 });
    }
    const action = target.slice("AWSCognitoIdentityProviderService.".length);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      const result = await this.#dispatch(action, body);
      return Response.json(result, {
        headers: { "content-type": "application/x-amz-json-1.1" },
      });
    } catch (e) {
      if (!(e instanceof CognitoFault)) throw e;
      return Response.json(
        { __type: e.type, message: e.message },
        {
          status: 400,
          headers: { "content-type": "application/x-amz-json-1.1", "x-amzn-errortype": e.type },
        },
      );
    }
  };

  #dispatch(action: string, b: Record<string, unknown>): Promise<unknown> | unknown {
    switch (action) {
      case "SignUp":
        return this.#signUp(b);
      case "ConfirmSignUp":
        return this.#confirmSignUp(b);
      case "ResendConfirmationCode":
        return this.#resendCode(b);
      case "InitiateAuth":
        return this.#initiateAuth(b);
      case "RespondToAuthChallenge":
        return this.#respond(b);
      case "ForgotPassword":
        return this.#forgotPassword(b);
      case "ConfirmForgotPassword":
        return this.#confirmForgotPassword(b);
      case "AssociateSoftwareToken":
        return this.#associate(b);
      case "VerifySoftwareToken":
        return this.#verifyTotp(b);
      case "SetUserMFAPreference":
        return this.#setMfa(b);
      case "AdminConfirmSignUp":
        return this.#adminConfirm(b);
      case "AdminDeleteUser":
        return this.#adminDelete(b);
      case "AdminGetUser":
        return this.#adminGet(b);
      case "DescribeUserPool":
        return this.#describePool(b);
      default:
        throw new CognitoFault("InvalidAction", `偽物の Cognito には ${action} がありません`);
    }
  }

  // ── 入口ごとの答え ─────────────────────────────────────────────────────────

  #client(b: Record<string, unknown>) {
    if (b.ClientId !== this.#opts.clientId) {
      throw new CognitoFault("ResourceNotFoundException", "User pool client does not exist.");
    }
  }

  #pool(b: Record<string, unknown>) {
    if (b.UserPoolId !== this.#poolId) {
      throw new CognitoFault("ResourceNotFoundException", "User pool does not exist.");
    }
  }

  #find(username: unknown): User | undefined {
    return typeof username === "string" ? this.#users.get(username.toLowerCase()) : undefined;
  }

  #checkPassword(password: unknown): string {
    const p = settings.passwordPolicy;
    if (typeof password !== "string")
      throw new CognitoFault("InvalidParameterException", "Password is required.");
    const problems = [
      password.length < p.minimumLength && "Password not long enough",
      p.requireLowercase && !/[a-z]/.test(password) && "Password must have lowercase characters",
      p.requireUppercase && !/[A-Z]/.test(password) && "Password must have uppercase characters",
      p.requireNumbers && !/[0-9]/.test(password) && "Password must have numeric characters",
      p.requireSymbols && !/[^A-Za-z0-9]/.test(password) && "Password must have symbol characters",
    ].filter(Boolean);
    if (problems.length > 0) {
      throw new CognitoFault(
        "InvalidPasswordException",
        `Password did not conform with policy: ${problems[0]}`,
      );
    }
    return password;
  }

  async #sendCode(user: User, purpose: "sign_up" | "reset") {
    const value = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const ttl = purpose === "sign_up" ? SIGN_UP_CODE_TTL_MS : RESET_CODE_TTL_MS;
    user.code = { value, purpose, expiresAt: this.#now() + ttl };
    const mail = {
      to: user.email,
      subject: settings.verificationEmail.subject,
      text: settings.verificationEmail.message.replace("{####}", value),
    };
    this.#sent.push({ ...mail, code: value });
    await this.#opts.sendMail?.(mail);
    return { Destination: mask(user.email), DeliveryMedium: "EMAIL", AttributeName: "email" };
  }

  async #signUp(b: Record<string, unknown>) {
    this.#client(b);
    const username = String(b.Username ?? "").toLowerCase();
    if (!username.includes("@"))
      throw new CognitoFault("InvalidParameterException", "Username should be an email.");
    if (this.#users.has(username))
      throw new CognitoFault(
        "UsernameExistsException",
        "An account with the given email already exists.",
      );
    const password = this.#checkPassword(b.Password);
    const user: User = {
      sub: fakeSub(username),
      email: username,
      password,
      status: "UNCONFIRMED",
      emailVerified: false,
      failures: 0,
      lockedUntil: 0,
    };
    this.#users.set(username, user);
    const delivery = await this.#sendCode(user, "sign_up");
    return { UserConfirmed: false, UserSub: user.sub, CodeDeliveryDetails: delivery };
  }

  #useCode(user: User | undefined, code: unknown, purpose: "sign_up" | "reset") {
    // いない人も「コードが違う」と同じ答え(prevent_user_existence_errors)
    if (!user?.code || user.code.purpose !== purpose || user.code.value !== code) {
      throw new CognitoFault(
        "CodeMismatchException",
        "Invalid verification code provided, please try again.",
      );
    }
    if (user.code.expiresAt < this.#now()) {
      throw new CognitoFault(
        "ExpiredCodeException",
        "Invalid code provided, please request a code again.",
      );
    }
    user.code = undefined;
  }

  #confirmSignUp(b: Record<string, unknown>) {
    this.#client(b);
    const user = this.#find(b.Username);
    if (user?.status === "CONFIRMED") {
      throw new CognitoFault(
        "NotAuthorizedException",
        "User cannot be confirmed. Current status is CONFIRMED",
      );
    }
    this.#useCode(user, b.ConfirmationCode, "sign_up");
    if (user) {
      // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_username -- 状態の名前で、ユーザー名ではない
      user.status = "CONFIRMED";
      user.emailVerified = true;
    }
    return {};
  }

  async #resendCode(b: Record<string, unknown>) {
    this.#client(b);
    const user = this.#find(b.Username);
    if (user?.status === "CONFIRMED")
      throw new CognitoFault("InvalidParameterException", "User is already confirmed.");
    // いない人にも、送ったような答え(prevent_user_existence_errors)
    if (!user)
      return {
        CodeDeliveryDetails: {
          Destination: mask(String(b.Username)),
          DeliveryMedium: "EMAIL",
          AttributeName: "email",
        },
      };
    return { CodeDeliveryDetails: await this.#sendCode(user, "sign_up") };
  }

  #initiateAuth(b: Record<string, unknown>) {
    this.#client(b);
    if (b.AuthFlow !== "USER_PASSWORD_AUTH") {
      throw new CognitoFault(
        "InvalidParameterException",
        "偽物の Cognito は USER_PASSWORD_AUTH だけです",
      );
    }
    const params = (b.AuthParameters ?? {}) as Record<string, unknown>;
    const user = this.#find(params.USERNAME);
    const wrong = () =>
      new CognitoFault("NotAuthorizedException", "Incorrect username or password.");
    if (!user) throw wrong();
    if (user.lockedUntil > this.#now())
      throw new CognitoFault("NotAuthorizedException", "Password attempts exceeded");
    if (user.password !== params.PASSWORD) {
      user.failures += 1;
      if (user.failures >= MAX_FAILURES) {
        user.failures = 0;
        user.lockedUntil = this.#now() + LOCK_MS;
        throw new CognitoFault("NotAuthorizedException", "Password attempts exceeded");
      }
      throw wrong();
    }
    user.failures = 0;
    if (user.status !== "CONFIRMED")
      throw new CognitoFault("UserNotConfirmedException", "User is not confirmed.");
    if (user.totp?.enabled) {
      const session = b64url(randomBytes(48));
      this.#sessions.set(session, {
        username: user.email,
        expiresAt: this.#now() + SESSION_TTL_MS,
      });
      return { ChallengeName: "SOFTWARE_TOKEN_MFA", Session: session, ChallengeParameters: {} };
    }
    return { AuthenticationResult: this.#tokens(user), ChallengeParameters: {} };
  }

  #respond(b: Record<string, unknown>) {
    this.#client(b);
    if (b.ChallengeName !== "SOFTWARE_TOKEN_MFA") {
      throw new CognitoFault(
        "InvalidParameterException",
        "偽物の Cognito は SOFTWARE_TOKEN_MFA だけです",
      );
    }
    const session = this.#sessions.get(String(b.Session ?? ""));
    const responses = (b.ChallengeResponses ?? {}) as Record<string, unknown>;
    const user = this.#find(responses.USERNAME);
    if (!session || session.expiresAt < this.#now() || !user || session.username !== user.email) {
      throw new CognitoFault(
        "NotAuthorizedException",
        "Invalid session for the user, session is expired.",
      );
    }
    if (!user.totp || !this.#totpMatches(user.totp.secret, responses.SOFTWARE_TOKEN_MFA_CODE)) {
      // 間違えたら、この札はもう使えない(パスワードからやり直す)。本物も同じかは契約テストが確かめる
      this.#sessions.delete(String(b.Session));
      throw new CognitoFault("CodeMismatchException", "Invalid code received for user");
    }
    this.#sessions.delete(String(b.Session));
    return { AuthenticationResult: this.#tokens(user), ChallengeParameters: {} };
  }

  async #forgotPassword(b: Record<string, unknown>) {
    this.#client(b);
    const user = this.#find(b.Username);
    // いない人・確認がまだの人にも、送ったような答え(prevent_user_existence_errors)
    if (user?.status !== "CONFIRMED") {
      return {
        CodeDeliveryDetails: {
          Destination: mask(String(b.Username)),
          DeliveryMedium: "EMAIL",
          AttributeName: "email",
        },
      };
    }
    return { CodeDeliveryDetails: await this.#sendCode(user, "reset") };
  }

  #confirmForgotPassword(b: Record<string, unknown>) {
    this.#client(b);
    const user = this.#find(b.Username);
    const password = this.#checkPassword(b.Password);
    this.#useCode(user, b.ConfirmationCode, "reset");
    if (user) {
      user.password = password;
      user.failures = 0;
      user.lockedUntil = 0;
    }
    return {};
  }

  #byAccessToken(b: Record<string, unknown>): User {
    const username = this.#accessTokens.get(String(b.AccessToken ?? ""));
    const user = this.#find(username);
    if (!user) throw new CognitoFault("NotAuthorizedException", "Invalid Access Token");
    return user;
  }

  #associate(b: Record<string, unknown>) {
    const user = this.#byAccessToken(b);
    const secret = Array.from(randomBytes(32), (x) => BASE32[x % 32]).join("");
    user.totp = { secret, verified: false, enabled: false };
    return { SecretCode: secret };
  }

  #verifyTotp(b: Record<string, unknown>) {
    const user = this.#byAccessToken(b);
    if (!user.totp || !this.#totpMatches(user.totp.secret, b.UserCode)) {
      throw new CognitoFault("EnableSoftwareTokenMFAException", "Code mismatch");
    }
    user.totp.verified = true;
    return { Status: "SUCCESS" };
  }

  #setMfa(b: Record<string, unknown>) {
    const user = this.#byAccessToken(b);
    const s = (b.SoftwareTokenMfaSettings ?? {}) as Record<string, unknown>;
    if (s.Enabled === true && !user.totp?.verified) {
      throw new CognitoFault(
        "InvalidParameterException",
        "User has not verified software token mfa",
      );
    }
    if (user.totp) user.totp.enabled = s.Enabled === true;
    return {};
  }

  #totpMatches(secret: string, code: unknown): boolean {
    const now = this.#now();
    return [-30_000, 0, 30_000].some((d) => totp(secret, now + d) === code);
  }

  #adminConfirm(b: Record<string, unknown>) {
    this.#pool(b);
    const user = this.#find(b.Username);
    if (!user) throw new CognitoFault("UserNotFoundException", "User does not exist.");
    // 本物と同じく、管理の確認ではメールは「確認済み」にならない
    // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_username -- 状態の名前で、ユーザー名ではない
    user.status = "CONFIRMED";
    return {};
  }

  #adminDelete(b: Record<string, unknown>) {
    this.#pool(b);
    const user = this.#find(b.Username);
    if (!user) throw new CognitoFault("UserNotFoundException", "User does not exist.");
    this.#users.delete(user.email);
    return {};
  }

  #adminGet(b: Record<string, unknown>) {
    this.#pool(b);
    const user = this.#find(b.Username);
    if (!user) throw new CognitoFault("UserNotFoundException", "User does not exist.");
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

  #describePool(b: Record<string, unknown>) {
    this.#pool(b);
    const p = settings.passwordPolicy;
    return {
      UserPool: {
        Id: this.#poolId,
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

  // ── トークン ─────────────────────────────────────────────────────────────────

  #tokens(user: User) {
    const now = Math.floor(this.#now() / 1000);
    const idToken = this.signIdToken({
      sub: user.sub,
      aud: this.#opts.clientId,
      email: user.email,
      email_verified: user.emailVerified,
      "cognito:username": user.sub,
      auth_time: now,
      iat: now,
      exp: now + TOKEN_TTL_S,
    });
    const accessToken = this.#sign({
      iss: this.issuer,
      sub: user.sub,
      client_id: this.#opts.clientId,
      token_use: "access",
      scope: "aws.cognito.signin.user.admin",
      username: user.sub,
      jti: randomUUID(),
      iat: now,
      exp: now + TOKEN_TTL_S,
    });
    this.#accessTokens.set(accessToken, user.email);
    return {
      IdToken: idToken,
      AccessToken: accessToken,
      RefreshToken: b64url(randomBytes(64)),
      ExpiresIn: TOKEN_TTL_S,
      TokenType: "Bearer",
    };
  }

  #sign(body: Record<string, unknown>, kid = "fake-1"): string {
    const header = { alg: "RS256", typ: "JWT", kid };
    const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(body))}`;
    return `${input}.${b64url(sign("sha256", Buffer.from(input), this.#privateKey))}`;
  }

  /** ID トークンを作る(テストで「変なトークン」を作るときにも使う)。iss と token_use は既定で本物と同じ */
  signIdToken(claims: Record<string, unknown>, opts: { kid?: string } = {}): string {
    return this.#sign({ iss: this.issuer, token_use: "id", ...claims }, opts.kid);
  }
}

export { serve } from "./serve.ts";
export { sendMailViaSmtp };

import {
  createHash,
  generateKeyPairSync,
  type KeyObject,
  randomBytes,
  randomInt,
  randomUUID,
  sign,
} from "node:crypto";
import settings from "../../shared/src/cognito-settings.json" with { type: "json" };
import type { SendMail } from "./smtp.ts";
import { totp } from "./totp.ts";

// 偽物の Cognito の中身(人・途中の札・トークン)と、入口どうしで使い回す確かめ方。
// 入口ごとの答えは actions/ に、HTTP の受け口は fake.ts に置く。

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

/** 入口に届いた本文(JSON) */
export type Body = Record<string, unknown>;

export type User = {
  sub: string;
  email: string;
  password: string;
  status: "UNCONFIRMED" | "CONFIRMED";
  emailVerified: boolean;
  code?: { value: string; purpose: CodePurpose; expiresAt: number };
  totp?: { secret: string; verified: boolean; enabled: boolean };
  /** メールの変更を申し込んで、まだ確認していない新しいメール(確認するまでは古いメールのまま) */
  pendingEmail?: string;
  failures: number;
  lockedUntil: number;
};

/** つないだ IdP(SAML)。偽物は MetadataURL を読みに行かない */
export type IdentityProvider = {
  type: string;
  details: Record<string, string>;
  attributeMapping: Record<string, string>;
};

/** 確認コードの使い道(登録・再設定・メールの変更) */
export type CodePurpose = "sign_up" | "reset" | "verify_email";

export class CognitoFault extends Error {
  readonly type: string;
  constructor(type: string, message: string) {
    super(message);
    this.type = type;
  }
}

const SIGN_UP_CODE_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_CODE_TTL_MS = 60 * 60 * 1000;
const VERIFY_EMAIL_CODE_TTL_MS = 24 * 60 * 60 * 1000;
const CODE_TTL_MS: Record<CodePurpose, number> = {
  sign_up: SIGN_UP_CODE_TTL_MS,
  reset: RESET_CODE_TTL_MS,
  verify_email: VERIFY_EMAIL_CODE_TTL_MS,
};
const TOKEN_TTL_S = 60 * 60;
/** アクセストークンの期限。stg・本番のアプリクライアントと同じ15分(infra/terraform の envs の cognito.tf) */
const ACCESS_TOKEN_TTL_S = 15 * 60;

export const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

/** 同じメールなら毎回同じ sub(本物の Cognito も、人ごとに変わらない ID を返す) */
export function fakeSub(email: string): string {
  const h = createHash("sha256").update(email.toLowerCase()).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** 確認コードの送り先。本物と同じ形で、宛先を伏せる(a***@e***) */
export function delivery(email: string) {
  const [local = "", domain = ""] = email.split("@");
  return {
    Destination: `${local.slice(0, 1)}***@${domain.slice(0, 1)}***`,
    DeliveryMedium: "EMAIL",
    AttributeName: "email",
  };
}

export class UserPool {
  readonly id: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly users = new Map<string, User>();
  readonly sessions = new Map<string, { username: string; expiresAt: number }>();
  /** アクセストークン → 誰の(メール)・いつまで。GlobalSignOut で消える */
  readonly accessTokens = new Map<string, { username: string; expiresAt: number }>();
  readonly sent: { to: string; subject: string; text: string; code: string }[] = [];
  /** つないだ IdP(CreateIdentityProvider)。名前 → 種類と設定。SSO の偽物は federation.ts */
  readonly identityProviders = new Map<string, IdentityProvider>();
  /** アプリクライアントが使える IdP(UpdateUserPoolClient の SupportedIdentityProviders) */
  supportedIdentityProviders: string[] = ["COGNITO"];
  readonly #opts: FakeCognitoOptions;
  readonly #privateKey: KeyObject;
  readonly #jwk: Record<string, unknown>;

  constructor(opts: FakeCognitoOptions) {
    this.#opts = opts;
    this.id = opts.userPoolId ?? "local_fakepool";
    this.clientId = opts.clientId;
    this.issuer = `${opts.baseUrl}/${this.id}`;
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    this.#privateKey = privateKey;
    this.#jwk = { ...publicKey.export({ format: "jwk" }), kid: "fake-1", alg: "RS256", use: "sig" };
  }

  get jwks(): { keys: Record<string, unknown>[] } {
    return { keys: [this.#jwk] };
  }

  now() {
    return this.#opts.now?.() ?? Date.now();
  }

  requireClient(b: Body) {
    if (b.ClientId !== this.clientId) {
      throw new CognitoFault("ResourceNotFoundException", "User pool client does not exist.");
    }
  }

  requirePool(b: Body) {
    if (b.UserPoolId !== this.id) {
      throw new CognitoFault("ResourceNotFoundException", "User pool does not exist.");
    }
  }

  find(username: unknown): User | undefined {
    return typeof username === "string" ? this.users.get(username.toLowerCase()) : undefined;
  }

  checkPassword(password: unknown): string {
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

  /** 確認コードを送る。宛先は既定で本人のメール(メールの変更なら新しいメール) */
  async sendCode(user: User, purpose: CodePurpose, to = user.email) {
    const value = randomInt(0, 1_000_000).toString().padStart(6, "0");
    user.code = { value, purpose, expiresAt: this.now() + CODE_TTL_MS[purpose] };
    const mail = {
      to,
      subject: settings.verificationEmail.subject,
      text: settings.verificationEmail.message.replace("{####}", value),
    };
    this.sent.push({ ...mail, code: value });
    await this.#opts.sendMail?.(mail);
    return delivery(to);
  }

  useCode(user: User | undefined, code: unknown, purpose: CodePurpose) {
    // いない人も「コードが違う」と同じ答え(prevent_user_existence_errors)
    if (!user?.code || user.code.purpose !== purpose || user.code.value !== code) {
      throw new CognitoFault(
        "CodeMismatchException",
        "Invalid verification code provided, please try again.",
      );
    }
    if (user.code.expiresAt < this.now()) {
      throw new CognitoFault(
        "ExpiredCodeException",
        "Invalid code provided, please request a code again.",
      );
    }
    user.code = undefined;
  }

  byAccessToken(b: Body): User {
    const token = this.accessTokens.get(String(b.AccessToken ?? ""));
    if (token && token.expiresAt <= Math.floor(this.now() / 1000)) {
      throw new CognitoFault("NotAuthorizedException", "Access Token has expired");
    }
    const user = this.find(token?.username);
    if (!user) throw new CognitoFault("NotAuthorizedException", "Invalid Access Token");
    return user;
  }

  /** メール(ログインの名前)を替える。sub・札・トークンは同じ人のまま */
  rename(user: User, email: string) {
    const old = user.email;
    this.users.delete(old);
    user.email = email;
    this.users.set(email, user);
    for (const t of this.accessTokens.values()) if (t.username === old) t.username = email;
    for (const s of this.sessions.values()) if (s.username === old) s.username = email;
  }

  totpMatches(secret: string, code: unknown): boolean {
    const now = this.now();
    return [-30_000, 0, 30_000].some((d) => totp(secret, now + d) === code);
  }

  // ── トークン ─────────────────────────────────────────────────────────────────

  tokens(user: User) {
    const now = Math.floor(this.now() / 1000);
    const idToken = this.signIdToken({
      sub: user.sub,
      aud: this.clientId,
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
      client_id: this.clientId,
      token_use: "access",
      scope: "aws.cognito.signin.user.admin",
      username: user.sub,
      jti: randomUUID(),
      iat: now,
      exp: now + ACCESS_TOKEN_TTL_S,
    });
    this.accessTokens.set(accessToken, {
      username: user.email,
      expiresAt: now + ACCESS_TOKEN_TTL_S,
    });
    return {
      IdToken: idToken,
      AccessToken: accessToken,
      RefreshToken: b64url(randomBytes(64)),
      ExpiresIn: ACCESS_TOKEN_TTL_S,
      TokenType: "Bearer",
    };
  }

  #sign(body: Record<string, unknown>, kid = "fake-1"): string {
    const header = { alg: "RS256", typ: "JWT", kid };
    const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(body))}`;
    return `${input}.${b64url(sign("sha256", Buffer.from(input), this.#privateKey))}`;
  }

  signIdToken(claims: Record<string, unknown>, opts: { kid?: string } = {}): string {
    return this.#sign({ iss: this.issuer, token_use: "id", ...claims }, opts.kid);
  }
}

import { createRemoteJWKSet, errors, type JWTVerifyGetKey, jwtVerify } from "jose";
import { ApiError, serviceUnavailable } from "../errors.ts";

// ─────────────────────────────────────────────────────────────────────────────
// 認証(パスワードの保管・照合・確認コード・二段階認証)は自作しない。Cognito に任せる。
// 画面は自前(デザインシステム)で、API が Cognito の API を呼ぶ(ADR 0009)。
//
//   dev     … 開発用。メールアドレスだけでログインできる。config.ts が local / test / preview
//             以外では起動させない(stg / prod で有効にすると起動時に落ちる)。
//   cognito … 画面 → API → Cognito。**トークンは API の中だけで扱い、ブラウザには Cookie しか渡さない**。
//
// Cognito の API は SDK を使わず、取り決め(JSON 1.1)どおりに fetch で呼ぶ(docs/guides/local-environment.md)。
// 手元とテストでは、偽物の Cognito(packages/fake-cognito)が同じ取り決めで答える。
// 偽物が本物とずれていないかは、契約テスト(packages/fake-cognito/contract)が本物と偽物の両方で確かめる。
// ─────────────────────────────────────────────────────────────────────────────

export type LoginIdentity =
  | { kind: "email"; email: string }
  /** verifiedEmail … Cognito が「確認済み」と言うメール。初めてのログインで users の行と結びつけるのに使う */
  | { kind: "external"; externalId: string; verifiedEmail: string | null };

export type CognitoSettings = {
  region: string;
  userPoolId: string;
  clientId: string;
  /** この画面の URL(https://app.example.com)。ログアウトの後の行き先 */
  appUrl: string;
  /** Cognito の API の入口を変える。手元の偽物の Cognito だけ(config.ts が local / test 以外では許さない) */
  endpoint?: string;
};

/** Cognito が返した失敗。type は Cognito の例外の名前(NotAuthorizedException など)。中身はログに出さない */
export class CognitoError extends Error {
  constructor(readonly type: string) {
    super(type);
  }
}

/** ログインの結果。トークンはここで確かめて、外には出さない */
export type AuthResult =
  | { kind: "signed_in"; identity: LoginIdentity }
  | { kind: "mfa"; session: string }
  | { kind: "not_confirmed" };

/** 待てば通る(Cognito の流量の上限・試しすぎ) */
const THROTTLED = new Set([
  "TooManyRequestsException",
  "LimitExceededException",
  "TooManyFailedAttemptsException",
]);

const tooManyRequests = () =>
  new ApiError(429, "too_many_requests", "試した回数が多すぎます。しばらく待ってください");

type Transport = { jwks?: JWTVerifyGetKey; fetch?: typeof fetch; timeoutMs?: number };

export class CognitoClient {
  readonly issuer: string;
  readonly #s: CognitoSettings;
  readonly #endpoint: string;
  readonly #jwks: JWTVerifyGetKey;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  /** transport … テスト用: 公開鍵と通信を差し替える */
  constructor(settings: CognitoSettings, transport: Transport = {}) {
    this.#s = settings;
    this.#endpoint = settings.endpoint ?? `https://cognito-idp.${settings.region}.amazonaws.com`;
    this.issuer = `${this.#endpoint}/${settings.userPoolId}`;
    this.#jwks =
      transport.jwks ?? createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`));
    this.#fetch = transport.fetch ?? fetch;
    this.#timeoutMs = transport.timeoutMs ?? 5_000;
  }

  /** ログアウトの後の行き先(GET /api/auth/options の logoutUrl)。Cognito 側に消す物は無い */
  get logoutUrl(): string {
    return `${this.#s.appUrl}/login`;
  }

  /**
   * Cognito の API を1つ呼ぶ。
   *   4xx(Cognito が断った)… CognitoError(type)。流量の上限・試しすぎは 429
   *   届かない・5xx・Cognito の中の失敗 … 503(「ログインできない」と「こちらが壊れている」を混ぜない)
   */
  async #call<T>(action: string, body: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await this.#fetch(`${this.#endpoint}/`, {
        method: "POST",
        headers: {
          "content-type": "application/x-amz-json-1.1",
          "x-amz-target": `AWSCognitoIdentityProviderService.${action}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (cause) {
      throw Object.assign(serviceUnavailable(), { cause });
    }
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.ok && json) return json as T;
    // 例外の名前は "__type"(先頭に "com.amazonaws...#" が付くことがある)
    const type =
      String(json?.__type ?? "")
        .split("#")
        .pop() ?? "";
    if (res.status >= 500 || !type || type === "InternalErrorException") throw serviceUnavailable();
    if (THROTTLED.has(type)) throw tooManyRequests();
    throw new CognitoError(type);
  }

  /** 登録。確認コードのメールは Cognito が送る */
  async signUp(email: string, password: string): Promise<void> {
    await this.#call("SignUp", {
      ClientId: this.#s.clientId,
      Username: email,
      Password: password,
      UserAttributes: [{ Name: "email", Value: email }],
    });
  }

  async confirmSignUp(email: string, code: string): Promise<void> {
    await this.#call("ConfirmSignUp", {
      ClientId: this.#s.clientId,
      Username: email,
      ConfirmationCode: code,
    });
  }

  async resendCode(email: string): Promise<void> {
    await this.#call("ResendConfirmationCode", { ClientId: this.#s.clientId, Username: email });
  }

  /** メールとパスワードでログイン。二段階認証が要る人は、次のコードを待つ session を返す */
  async signIn(email: string, password: string): Promise<AuthResult> {
    try {
      const r = await this.#call<{
        AuthenticationResult?: { IdToken?: string };
        ChallengeName?: string;
        Session?: string;
      }>("InitiateAuth", {
        ClientId: this.#s.clientId,
        AuthFlow: "USER_PASSWORD_AUTH",
        AuthParameters: { USERNAME: email, PASSWORD: password },
      });
      return await this.#toResult(r);
    } catch (e) {
      // パスワードが合っていて、確認コードがまだの人(パスワードを知っている本人なので、伝えてよい)
      if (e instanceof CognitoError && e.type === "UserNotConfirmedException") {
        return { kind: "not_confirmed" };
      }
      throw e;
    }
  }

  async answerMfa(email: string, session: string, code: string): Promise<AuthResult> {
    const r = await this.#call<{
      AuthenticationResult?: { IdToken?: string };
      ChallengeName?: string;
      Session?: string;
    }>("RespondToAuthChallenge", {
      ClientId: this.#s.clientId,
      ChallengeName: "SOFTWARE_TOKEN_MFA",
      Session: session,
      ChallengeResponses: { USERNAME: email, SOFTWARE_TOKEN_MFA_CODE: code },
    });
    return this.#toResult(r);
  }

  async forgotPassword(email: string): Promise<void> {
    await this.#call("ForgotPassword", { ClientId: this.#s.clientId, Username: email });
  }

  async resetPassword(email: string, code: string, password: string): Promise<void> {
    await this.#call("ConfirmForgotPassword", {
      ClientId: this.#s.clientId,
      Username: email,
      ConfirmationCode: code,
      Password: password,
    });
  }

  async #toResult(r: {
    AuthenticationResult?: { IdToken?: string };
    ChallengeName?: string;
    Session?: string;
  }): Promise<AuthResult> {
    if (r.ChallengeName === "SOFTWARE_TOKEN_MFA" && r.Session) {
      return { kind: "mfa", session: r.Session };
    }
    const idToken = r.AuthenticationResult?.IdToken;
    // ほかの関門(新しいパスワードが要る など)は、この画面では扱わない
    if (!idToken) throw new CognitoError(`UnsupportedChallenge:${r.ChallengeName ?? "none"}`);
    const identity = await this.verify(idToken);
    if (!identity) throw new CognitoError("InvalidIdToken");
    return { kind: "signed_in", identity };
  }

  /**
   * ID トークンを確かめる。署名・発行元・宛先・種類を見る。正しくなければ null。
   * Cognito の公開鍵を取りに行けない(通信の失敗・時間切れ・変な応答)ときは 503 を投げる。
   */
  async verify(idToken: string): Promise<LoginIdentity | null> {
    try {
      const { payload } = await jwtVerify(idToken, this.#jwks, {
        issuer: this.issuer,
        audience: this.#s.clientId,
        algorithms: ["RS256"],
      });
      if (payload.token_use !== "id" || typeof payload.sub !== "string") return null;
      // Cognito は email_verified を真偽値で返す(古いものは文字列の "true")
      const verified = payload.email_verified === true || payload.email_verified === "true";
      const email = typeof payload.email === "string" ? payload.email : null;
      return {
        kind: "external",
        externalId: payload.sub,
        verifiedEmail: verified && email ? email : null,
      };
    } catch (e) {
      const infra =
        !(e instanceof errors.JOSEError) ||
        e instanceof errors.JWKSTimeout ||
        e instanceof errors.JWKSInvalid;
      if (infra) throw Object.assign(serviceUnavailable(), { cause: e });
      return null;
    }
  }
}

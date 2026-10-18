import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, errors, type JWTVerifyGetKey, jwtVerify } from "jose";
import { serviceUnavailable } from "../errors.ts";

// ─────────────────────────────────────────────────────────────────────────────
// 認証(ログイン)は自作しない。本物は Cognito に任せ、ここは「差し替え口」だけ。
//
//   dev     … 開発用。メールアドレスだけでログインできる。config.ts が local / test / preview
//             以外では起動させない(stg / prod で有効にすると起動時に落ちる)。
//   cognito … Cognito の画面(Managed Login)でログインし、戻ってきた code を API が ID トークンに替える
//             (認可コード+PKCE)。**トークンはサーバーの中だけで扱い、ブラウザには Cookie しか渡さない**。
//
// どちらも「この人は users のどの行か」を返すだけ。セッションを作るのは auth/routes.ts。
// 手元とテストでは、偽物の Cognito(packages/fake-cognito)が同じ入口で答える。
// ─────────────────────────────────────────────────────────────────────────────

export type LoginIdentity =
  | { kind: "email"; email: string }
  /** verifiedEmail … Cognito が「確認済み」と言うメール。初めてのログインで users の行と結びつけるのに使う */
  | { kind: "external"; externalId: string; verifiedEmail: string | null };

export type CognitoSettings = {
  region: string;
  userPoolId: string;
  clientId: string;
  /** Cognito の画面の入口(https://<接頭辞>.auth.<region>.amazoncognito.com か独自ドメイン) */
  domain: string;
  /** この画面の URL(https://app.example.com)。戻り先とログアウトの後の行き先を作る */
  appUrl: string;
  /** 発行元。手元の偽物の Cognito を使うときだけ変える(config.ts が local / test 以外では許さない) */
  issuer?: string;
  /** ZAP の認証つきスキャン用のアプリクライアント(stg だけ。config.ts が prod では許さない) */
  scanClientId?: string;
};

/** ログインできなかった理由。中身はログに出さない(code やトークンが入ることがある)ので、理由の名前だけを持つ */
export class CognitoRejected extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

const b64url = (buf: Buffer) => buf.toString("base64url");
export const randomToken = () => b64url(randomBytes(32));
export const pkceChallenge = (verifier: string) =>
  b64url(createHash("sha256").update(verifier).digest());

/** かかる時間で中身が分からない比べ方(長さが違っても同じ時間) */
export function sameSecret(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

type Transport = { jwks?: JWTVerifyGetKey; fetch?: typeof fetch; timeoutMs?: number };

export class CognitoClient {
  readonly issuer: string;
  readonly redirectUri: string;
  readonly #s: CognitoSettings;
  readonly #jwks: JWTVerifyGetKey;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  /** transport … テスト用: 公開鍵と通信を差し替える */
  constructor(settings: CognitoSettings, transport: Transport = {}) {
    this.#s = settings;
    this.issuer =
      settings.issuer ??
      `https://cognito-idp.${settings.region}.amazonaws.com/${settings.userPoolId}`;
    this.redirectUri = `${settings.appUrl}/api/auth/callback`;
    this.#jwks =
      transport.jwks ?? createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`));
    this.#fetch = transport.fetch ?? fetch;
    this.#timeoutMs = transport.timeoutMs ?? 5_000;
  }

  get scanEnabled() {
    return Boolean(this.#s.scanClientId);
  }

  /** Cognito の画面へ送る URL。state(取り違え防止)・nonce(トークンの使い回し防止)・PKCE を付ける */
  authorizeUrl(p: { state: string; nonce: string; codeVerifier: string }): string {
    const url = new URL("/oauth2/authorize", this.#s.domain);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: this.#s.clientId,
      redirect_uri: this.redirectUri,
      scope: "openid email",
      state: p.state,
      nonce: p.nonce,
      code_challenge: pkceChallenge(p.codeVerifier),
      code_challenge_method: "S256",
    }).toString();
    return url.toString();
  }

  /** Cognito 側のログインも終わらせて、ログイン画面に戻る URL */
  get logoutUrl(): string {
    const url = new URL("/logout", this.#s.domain);
    url.search = new URLSearchParams({
      client_id: this.#s.clientId,
      logout_uri: `${this.#s.appUrl}/login`,
    }).toString();
    return url.toString();
  }

  /**
   * 戻ってきた code を ID トークンに替えて、確かめる。
   *   code が使えない(古い・使い済み・別の人の)・トークンがおかしい … CognitoRejected(→ ログインできませんでした)
   *   Cognito に届かない・Cognito が 5xx … 503 を投げる(→ 止まっています)
   */
  async exchange(code: string, codeVerifier: string, nonce: string): Promise<LoginIdentity> {
    let res: Response;
    try {
      res = await this.#fetch(new URL("/oauth2/token", this.#s.domain), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: this.#s.clientId,
          code,
          redirect_uri: this.redirectUri,
          code_verifier: codeVerifier,
        }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (cause) {
      throw Object.assign(serviceUnavailable(), { cause });
    }
    if (res.status >= 500) throw serviceUnavailable();
    const body = (await res.json().catch(() => null)) as { id_token?: unknown } | null;
    if (!res.ok || typeof body?.id_token !== "string") {
      throw new CognitoRejected(`token_endpoint_${res.status}`);
    }
    const identity = await this.verify(body.id_token, { audience: this.#s.clientId, nonce });
    if (!identity) throw new CognitoRejected("id_token_invalid");
    return identity;
  }

  /** ZAP のスキャン用: スキャン用のクライアント宛ての ID トークンだけを受け付ける */
  verifyScanToken(idToken: string): Promise<LoginIdentity | null> {
    if (!this.#s.scanClientId) return Promise.resolve(null);
    return this.verify(idToken, { audience: this.#s.scanClientId, nonce: null });
  }

  /**
   * ID トークンを確かめる。署名・発行元・宛先・種類・nonce を見る。正しくなければ null。
   * Cognito の公開鍵を取りに行けない(通信の失敗・時間切れ・変な応答)ときは 503 を投げる。
   * 「ログインできない」と「こちらが壊れている」を混ぜない(混ぜると障害に気づけない)。
   */
  async verify(
    idToken: string,
    expected: { audience: string; nonce: string | null },
  ): Promise<LoginIdentity | null> {
    try {
      const { payload } = await jwtVerify(idToken, this.#jwks, {
        issuer: this.issuer,
        audience: expected.audience,
        algorithms: ["RS256"],
      });
      if (payload.token_use !== "id" || typeof payload.sub !== "string") return null;
      if (expected.nonce !== null) {
        if (typeof payload.nonce !== "string" || !sameSecret(payload.nonce, expected.nonce))
          return null;
      }
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

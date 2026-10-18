import { createRemoteJWKSet, errors, type JWTVerifyGetKey, jwtVerify } from "jose";
import { serviceUnavailable } from "../errors.ts";

// ─────────────────────────────────────────────────────────────────────────────
// 認証(ログイン)は自作しない。本物は Cognito に任せ、ここは「差し替え口」だけ。
//
//   dev     … 開発用。メールアドレスだけでログインできる。config.ts が local / test / preview
//             以外では起動させない(stg / prod で有効にすると起動時に落ちる)。
//   cognito … Cognito のホスト UI でログインした結果の ID トークンを検証する。
//
// どちらも「この人は users のどの行か」を返すだけ。セッションを作るのは auth/routes.ts。
// ─────────────────────────────────────────────────────────────────────────────

export type LoginIdentity =
  | { kind: "email"; email: string }
  | { kind: "external"; externalId: string };

export type CognitoSettings = { region: string; userPoolId: string; clientId: string };

/** Cognito の ID トークンを検証して、利用者の sub を返す。署名・発行元・宛先・種類を確かめる。 */
export class CognitoVerifier {
  readonly #issuer: string;
  readonly #clientId: string;
  readonly #jwks: JWTVerifyGetKey;

  constructor(settings: CognitoSettings, jwks?: JWTVerifyGetKey) {
    this.#issuer = `https://cognito-idp.${settings.region}.amazonaws.com/${settings.userPoolId}`;
    this.#clientId = settings.clientId;
    this.#jwks = jwks ?? createRemoteJWKSet(new URL(`${this.#issuer}/.well-known/jwks.json`));
  }

  /**
   * トークンが正しくなければ null(→ 401)。
   * Cognito の公開鍵を取りに行けない(通信の失敗・時間切れ・変な応答)ときは 503 を投げる。
   * 「パスワードが違う」と「こちらが壊れている」を混ぜない(混ぜると障害に気づけない)。
   */
  async verify(idToken: string): Promise<LoginIdentity | null> {
    try {
      const { payload } = await jwtVerify(idToken, this.#jwks, {
        issuer: this.#issuer,
        audience: this.#clientId,
        algorithms: ["RS256"],
      });
      if (payload.token_use !== "id" || typeof payload.sub !== "string") return null;
      return { kind: "external", externalId: payload.sub };
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

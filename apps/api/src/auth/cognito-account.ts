import { type CognitoClient, CognitoError } from "./providers.ts";

// ログインした本人の操作(docs/designs/0006-account-security.md の 5)。
// どれも、パスワード(と二段階認証のコード)を入れ直して得たアクセストークンで呼ぶ。IAM は要らない。
// アクセストークンは API の中で使い、ブラウザには暗号化した札(reauth.ts)でしか渡さない。

type Tokens = {
  AuthenticationResult?: { AccessToken?: string };
  ChallengeName?: string;
  Session?: string;
};

/** 確かめ直しの結果。mfa … 二段階認証のコードを聞かれたか(= Cognito で有効か。写しを直すのに使う) */
export type Reauthenticated = { accessToken: string; mfa: boolean };

/** 二段階認証が有効な人なのに、コードが無い(画面は最初からコードの欄を出す) */
export class MfaCodeRequired extends Error {}

export class CognitoAccount {
  readonly #c: CognitoClient;

  constructor(client: CognitoClient) {
    this.#c = client;
  }

  /**
   * パスワード(と、有効ならコード)を入れ直してもらい、アクセストークンを得る。1回のリクエストの中で
   * InitiateAuth → RespondToAuthChallenge まで済ませる(途中の札は API の外に出さない)。
   */
  async reauthenticate(email: string, password: string, code?: string): Promise<Reauthenticated> {
    const first = await this.#c.call<Tokens>("InitiateAuth", {
      ClientId: this.#c.clientId,
      AuthFlow: "USER_PASSWORD_AUTH",
      AuthParameters: { USERNAME: email, PASSWORD: password },
    });
    if (first.ChallengeName !== "SOFTWARE_TOKEN_MFA") {
      return { accessToken: tokenOf(first), mfa: false };
    }
    if (!code) throw new MfaCodeRequired();
    const second = await this.#c.call<Tokens>("RespondToAuthChallenge", {
      ClientId: this.#c.clientId,
      ChallengeName: "SOFTWARE_TOKEN_MFA",
      Session: first.Session,
      ChallengeResponses: { USERNAME: email, SOFTWARE_TOKEN_MFA_CODE: code },
    });
    return { accessToken: tokenOf(second), mfa: true };
  }

  /** 二段階認証の鍵を作る(呼ぶたびに新しい鍵。前の鍵は使えなくなる) */
  async associateTotp(accessToken: string): Promise<string> {
    const r = await this.#c.call<{ SecretCode?: string }>("AssociateSoftwareToken", {
      AccessToken: accessToken,
    });
    if (!r.SecretCode) throw new CognitoError("NoSecretCode");
    return r.SecretCode;
  }

  /** 認証アプリのコードで鍵を確かめ、二段階認証を有効にする */
  async enableTotp(accessToken: string, code: string): Promise<void> {
    await this.#c.call("VerifySoftwareToken", {
      AccessToken: accessToken,
      UserCode: code,
      FriendlyDeviceName: "authenticator",
    });
    await this.#setTotp(accessToken, true);
  }

  async disableTotp(accessToken: string): Promise<void> {
    await this.#setTotp(accessToken, false);
  }

  async #setTotp(accessToken: string, enabled: boolean) {
    await this.#c.call("SetUserMFAPreference", {
      AccessToken: accessToken,
      SoftwareTokenMfaSettings: { Enabled: enabled, PreferredMfa: enabled },
    });
  }

  async changePassword(accessToken: string, previous: string, proposed: string): Promise<void> {
    await this.#c.call("ChangePassword", {
      AccessToken: accessToken,
      PreviousPassword: previous,
      ProposedPassword: proposed,
    });
  }

  /** メールの変更を申し込む。確認コードは Cognito が新しいアドレスへ送る(確認するまで古いメールのまま) */
  async requestEmailChange(accessToken: string, newEmail: string): Promise<void> {
    await this.#c.call("UpdateUserAttributes", {
      AccessToken: accessToken,
      UserAttributes: [{ Name: "email", Value: newEmail }],
    });
  }

  async confirmEmailChange(accessToken: string, code: string): Promise<void> {
    await this.#c.call("VerifyUserAttribute", {
      AccessToken: accessToken,
      AttributeName: "email",
      Code: code,
    });
  }

  /** アクセストークンを全部無効にする(変更を終えたら呼ぶ。アプリのセッションは自前の Cookie なので切れない) */
  async signOutEverywhere(accessToken: string): Promise<void> {
    await this.#c.call("GlobalSignOut", { AccessToken: accessToken });
  }
}

function tokenOf(r: Tokens): string {
  const token = r.AuthenticationResult?.AccessToken;
  // ほかの関門(新しいパスワードが要る など)は、この画面では扱わない
  if (!token) throw new CognitoError(`UnsupportedChallenge:${r.ChallengeName ?? "none"}`);
  return token;
}

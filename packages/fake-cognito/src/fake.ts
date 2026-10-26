import {
  changePassword,
  getUser,
  globalSignOut,
  updateUserAttributes,
  verifyUserAttribute,
} from "./actions/account.ts";
import {
  adminConfirmSignUp,
  adminDeleteUser,
  adminGetUser,
  describeUserPool,
} from "./actions/admin.ts";
import {
  createIdentityProvider,
  deleteIdentityProvider,
  describeIdentityProvider,
  describeUserPoolClient,
  updateUserPoolClient,
} from "./actions/federation.ts";
import {
  associateSoftwareToken,
  initiateAuth,
  respondToChallenge,
  setMfaPreference,
  verifySoftwareToken,
} from "./actions/sign-in.ts";
import {
  confirmForgotPassword,
  confirmSignUp,
  forgotPassword,
  resendCode,
  signUp,
} from "./actions/sign-up.ts";
import { Federation } from "./federation.ts";
import { type Body, CognitoFault, type FakeCognitoOptions, UserPool } from "./pool.ts";
import { sendMailViaSmtp } from "./smtp.ts";

// ─────────────────────────────────────────────────────────────────────────────
// 開発とテスト専用の「偽物の Cognito」。本物の Cognito の API(JSON 1.1・x-amz-target)と同じ形で答える。
// **アプリ(apps/api/src/auth/providers.ts)が使う入口と、契約テストが使う管理の入口だけ**を持つ。
//
//   登録     … SignUp・ConfirmSignUp・ResendConfirmationCode
//   ログイン … InitiateAuth(USER_PASSWORD_AUTH)・RespondToAuthChallenge(SOFTWARE_TOKEN_MFA)
//   再設定   … ForgotPassword・ConfirmForgotPassword
//   二段階   … AssociateSoftwareToken・VerifySoftwareToken・SetUserMFAPreference
//   本人     … GetUser・ChangePassword・UpdateUserAttributes・VerifyUserAttribute・GlobalSignOut
//   管理     … AdminConfirmSignUp・AdminDeleteUser・AdminGetUser・DescribeUserPool(署名は確かめない)
//   IdP      … CreateIdentityProvider・DescribeIdentityProvider・DeleteIdentityProvider・
//              DescribeUserPoolClient・UpdateUserPoolClient(SupportedIdentityProviders だけ)
//   SSO      … GET /oauth2/authorize・POST /oauth2/token と、テスト用の IdP の画面(federation.ts)
//   公開鍵   … GET /<プール>/.well-known/jwks.json
//
// 本物と同じく断る(決まりを満たさないパスワード・違うコード・その人がいない・試しすぎ)。
// 「本物と同じか」は契約テスト(contract/)が本物と偽物の両方に同じテストを流して確かめる。偽物の振る舞いを
// 変えたら契約テストも直し、stg の本物で通ることを確かめる。設定は cognito-settings.json(Terraform も読む)。
// **本番では使わない**。
// ─────────────────────────────────────────────────────────────────────────────

// 中身(人・札・トークン)は pool.ts、入口ごとの答えは actions/、ここは HTTP の受け口だけ。

/** x-amz-target の操作名 → 答え */
const ACTIONS = new Map<string, (pool: UserPool, b: Body) => unknown>([
  ["SignUp", signUp],
  ["ConfirmSignUp", confirmSignUp],
  ["ResendConfirmationCode", resendCode],
  ["InitiateAuth", initiateAuth],
  ["RespondToAuthChallenge", respondToChallenge],
  ["ForgotPassword", forgotPassword],
  ["ConfirmForgotPassword", confirmForgotPassword],
  ["AssociateSoftwareToken", associateSoftwareToken],
  ["VerifySoftwareToken", verifySoftwareToken],
  ["SetUserMFAPreference", setMfaPreference],
  ["GetUser", getUser],
  ["ChangePassword", changePassword],
  ["UpdateUserAttributes", updateUserAttributes],
  ["VerifyUserAttribute", verifyUserAttribute],
  ["GlobalSignOut", globalSignOut],
  ["AdminConfirmSignUp", adminConfirmSignUp],
  ["AdminDeleteUser", adminDeleteUser],
  ["AdminGetUser", adminGetUser],
  ["DescribeUserPool", describeUserPool],
  ["CreateIdentityProvider", createIdentityProvider],
  ["DescribeIdentityProvider", describeIdentityProvider],
  ["DeleteIdentityProvider", deleteIdentityProvider],
  ["DescribeUserPoolClient", describeUserPoolClient],
  ["UpdateUserPoolClient", updateUserPoolClient],
]);

const TARGET_PREFIX = "AWSCognitoIdentityProviderService.";
const JSON_TYPE = "application/x-amz-json-1.1";

export class FakeCognito {
  readonly issuer: string;
  readonly #pool: UserPool;
  readonly #federation: Federation;

  constructor(opts: FakeCognitoOptions) {
    this.#pool = new UserPool(opts);
    this.#federation = new Federation(this.#pool);
    this.issuer = this.#pool.issuer;
  }

  /**
   * テスト用: IdP へ回す URL(/oauth2/authorize)に、IdP がこのメールの人を返したことにしてコードを出す
   * (結合テストが、テスト用の IdP の画面の代わりに使う)
   */
  issueSsoCode(authorizeUrl: string, email: string): string {
    return this.#federation.issueCode(new URL(authorizeUrl).searchParams, email.toLowerCase());
  }

  /** 公開鍵(テストでは createLocalJWKSet に渡す) */
  get jwks(): { keys: Record<string, unknown>[] } {
    return this.#pool.jwks;
  }

  /** テスト用: その人に最後に送った確認コード */
  lastCode(email: string): string | undefined {
    return this.#pool.sent.findLast((m) => m.to === email.toLowerCase())?.code;
  }

  /** Web 標準の Request → Response(テストからはこれを直接呼ぶ) */
  fetch = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === `/${this.#pool.id}/.well-known/jwks.json`) {
      return Response.json(this.jwks);
    }
    if (req.method === "GET" && url.pathname === "/healthz") return new Response("ok");
    const sso = await this.#federation.handle(req);
    if (sso) return sso;
    const target = req.headers.get("x-amz-target") ?? "";
    if (req.method !== "POST" || !target.startsWith(TARGET_PREFIX)) {
      return new Response("not found", { status: 404 });
    }
    const action = target.slice(TARGET_PREFIX.length);
    const body = (await req.json().catch(() => ({}))) as Body;
    try {
      const result = await this.#dispatch(action, body);
      return Response.json(result, { headers: { "content-type": JSON_TYPE } });
    } catch (e) {
      if (!(e instanceof CognitoFault)) throw e;
      return Response.json(
        { __type: e.type, message: e.message },
        { status: 400, headers: { "content-type": JSON_TYPE, "x-amzn-errortype": e.type } },
      );
    }
  };

  #dispatch(action: string, b: Body): unknown {
    const handle = ACTIONS.get(action);
    if (!handle)
      throw new CognitoFault("InvalidAction", `偽物の Cognito には ${action} がありません`);
    return handle(this.#pool, b);
  }

  /** ID トークンを作る(テストで「変なトークン」を作るときにも使う)。iss と token_use は既定で本物と同じ */
  signIdToken(claims: Record<string, unknown>, opts: { kid?: string } = {}): string {
    return this.#pool.signIdToken(claims, opts);
  }
}

export { federatedSub } from "./federation.ts";
export type { FakeCognitoOptions } from "./pool.ts";
export { fakeSub } from "./pool.ts";
export { serve } from "./serve.ts";
export { totp } from "./totp.ts";
export { sendMailViaSmtp };

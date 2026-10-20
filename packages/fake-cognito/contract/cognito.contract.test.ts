import { createPublicKey, type JsonWebKey, randomUUID, verify } from "node:crypto";
import {
  AdminConfirmSignUpCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AssociateSoftwareTokenCommand,
  CognitoIdentityProviderClient,
  ConfirmSignUpCommand,
  DescribeUserPoolCommand,
  ForgotPasswordCommand,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  SetUserMFAPreferenceCommand,
  SignUpCommand,
  VerifySoftwareTokenCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import settings from "../../shared/src/cognito-settings.json" with { type: "json" };
import { FakeCognito, totp } from "../src/fake.ts";
import { serve } from "../src/serve.ts";

// ─────────────────────────────────────────────────────────────────────────────
// 契約テスト: **同じテストを、偽物の Cognito と stg の本物の Cognito の両方に流す**。
// 本物で落ちたら、偽物(と、それに合わせて書いたアプリ)が本物とずれている合図。
//
//   偽物: pnpm --filter @app/fake-cognito test(PR ごと。CI の単体)
//   本物: COGNITO_CONTRACT_TARGET=real pnpm --filter @app/fake-cognito test:contract
//         (.github/workflows/cognito-contract.yml が週1回と手動で。stg のユーザープールに試しの人を作って消す)
//
// AWS 公式の SDK でつなぐので、「偽物が本物の SDK と話せるか」も同時に確かめている。
// 見ているのはアプリ(apps/api/src/auth/providers.ts)が頼っている振る舞いだけ。
// 偽物を直したら、ここも直して、本物で通ることを確かめる(docs/guides/local-environment.md)。
// ─────────────────────────────────────────────────────────────────────────────

const REAL = process.env.COGNITO_CONTRACT_TARGET === "real";
const env = process.env;

let client: CognitoIdentityProviderClient;
let issuer: string;
let poolId: string;
let clientId: string;
let close: (() => Promise<void>) | undefined;
// 偽物の時計。偽物に流すときは、二段階認証のコードの切り替わり(30秒)を待たずに時計を進める
let skew = 0;
const clock = () => Date.now() + skew;

// 本物では SES の試し用の宛先(サンドボックスでも送れて、どこにも届かない)
const runId = `${Date.now()}${randomUUID().slice(0, 4)}`;
const emailFor = (label: string) =>
  REAL
    ? `success+contract-${label}-${runId}@simulator.amazonses.com`
    : `contract-${label}-${runId}@example.test`;
// 試しの人のパスワード(終わったら人ごと消す。本物の秘密ではない)
// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_password
const PASSWORD = "Contract-Test-1234";
const created: string[] = [];

beforeAll(async () => {
  if (REAL) {
    const region = env.COGNITO_REGION ?? "ap-northeast-1";
    poolId = env.COGNITO_USER_POOL_ID ?? "";
    clientId = env.COGNITO_CLIENT_ID ?? "";
    if (!poolId || !clientId)
      throw new Error("COGNITO_USER_POOL_ID と COGNITO_CLIENT_ID が要ります");
    client = new CognitoIdentityProviderClient({ region });
    issuer = `https://cognito-idp.${region}.amazonaws.com/${poolId}`;
  } else {
    poolId = "local_contractpool";
    clientId = "contract-client";
    // 発行元は、SDK がつなぐのと同じ URL にする(本物と同じく「入口/プール」)
    let fake: FakeCognito | undefined;
    const server = await serve((req) => (fake as FakeCognito).fetch(req), 0);
    fake = new FakeCognito({ baseUrl: server.url, userPoolId: poolId, clientId, now: clock });
    close = server.close;
    client = new CognitoIdentityProviderClient({
      region: "ap-northeast-1",
      endpoint: server.url,
      credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
    });
    issuer = fake.issuer;
  }
});

afterAll(async () => {
  for (const email of created) {
    await client
      .send(new AdminDeleteUserCommand({ UserPoolId: poolId, Username: email }))
      .catch(() => {});
  }
  await close?.();
});

const signUp = (email: string, password = PASSWORD) =>
  client.send(
    new SignUpCommand({
      ClientId: clientId,
      Username: email,
      Password: password,
      UserAttributes: [{ Name: "email", Value: email }],
    }),
  );

const confirmSignUp = (email: string, code: string) =>
  client.send(
    new ConfirmSignUpCommand({ ClientId: clientId, Username: email, ConfirmationCode: code }),
  );

/** 二段階認証のコードを答える */
const answerMfa = (session: string | undefined, email: string, code: string) =>
  client.send(
    new RespondToAuthChallengeCommand({
      ClientId: clientId,
      ChallengeName: "SOFTWARE_TOKEN_MFA",
      Session: session,
      ChallengeResponses: { USERNAME: email, SOFTWARE_TOKEN_MFA_CODE: code },
    }),
  );

/** 登録して、管理の確認で「確認済み」にした人を作る(本物では確認コードのメールを読めないため) */
async function confirmedUser(label: string) {
  const email = emailFor(label);
  await signUp(email);
  created.push(email);
  await client.send(new AdminConfirmSignUpCommand({ UserPoolId: poolId, Username: email }));
  return email;
}

const signIn = (email: string, password = PASSWORD) =>
  client.send(
    new InitiateAuthCommand({
      ClientId: clientId,
      AuthFlow: "USER_PASSWORD_AUTH",
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }),
  );

const errorOf = (p: Promise<unknown>) =>
  p.then(
    () => ({ name: "(成功した)", message: "" }),
    (e: Error) => ({ name: e.name, message: e.message }),
  );

/** ID トークンの署名を、発行元の公開鍵で確かめて中身を返す */
async function verifiedClaims(idToken: string): Promise<Record<string, unknown>> {
  const [h = "", p = "", s = ""] = idToken.split(".");
  const header = JSON.parse(Buffer.from(h, "base64url").toString()) as { kid: string; alg: string };
  const { keys } = (await (await fetch(`${issuer}/.well-known/jwks.json`)).json()) as {
    keys: (JsonWebKey & { kid: string })[];
  };
  const jwk = keys.find((k) => k.kid === header.kid);
  expect(jwk, "公開鍵の一覧に kid がある").toBeDefined();
  expect(header.alg).toBe("RS256");
  const ok = verify(
    "sha256",
    Buffer.from(`${h}.${p}`),
    createPublicKey({ key: jwk as JsonWebKey, format: "jwk" }),
    Buffer.from(s, "base64url"),
  );
  expect(ok, "署名が合う").toBe(true);
  return JSON.parse(Buffer.from(p, "base64url").toString());
}

/** 次の30秒の区切りまで待つ(同じ二段階認証のコードを2回使わないため)。偽物なら時計を進めるだけ */
const nextTotpWindow = async () => {
  if (!REAL) {
    skew += 30_000;
    return;
  }
  await new Promise((r) => setTimeout(r, 30_000 - (Date.now() % 30_000) + 500));
};

const TARGET = REAL ? "stg の本物" : "偽物";

describe(`Cognito の契約(${TARGET}): 設定と登録`, () => {
  it("ユーザープールの設定が cognito-settings.json と同じ(Terraform と偽物が同じ物を読んでいる)", async () => {
    const { UserPool } = await client.send(new DescribeUserPoolCommand({ UserPoolId: poolId }));
    const p = settings.passwordPolicy;
    expect(UserPool?.Policies?.PasswordPolicy).toMatchObject({
      MinimumLength: p.minimumLength,
      RequireLowercase: p.requireLowercase,
      RequireUppercase: p.requireUppercase,
      RequireNumbers: p.requireNumbers,
      RequireSymbols: p.requireSymbols,
    });
    expect(UserPool?.UsernameAttributes).toEqual(["email"]);
    expect(UserPool?.VerificationMessageTemplate).toMatchObject({
      EmailSubject: settings.verificationEmail.subject,
      EmailMessage: settings.verificationEmail.message,
    });
  });

  it("決まりを満たさないパスワードの登録は InvalidPasswordException", async () => {
    const email = emailFor("weak");
    const e = await errorOf(signUp(email, "short"));
    expect(e.name).toBe("InvalidPasswordException");
  });

  it("登録すると未確認で、確認コードはメールで送られる。同じメールの2回目は UsernameExistsException", async () => {
    const email = emailFor("signup");
    const r = await signUp(email);
    created.push(email);
    expect(r.UserConfirmed).toBe(false);
    expect(r.CodeDeliveryDetails).toMatchObject({
      DeliveryMedium: "EMAIL",
      AttributeName: "email",
    });
    const again = await errorOf(signUp(email));
    expect(again.name).toBe("UsernameExistsException");
    // 確認前は、パスワードが合っていても UserNotConfirmedException
    expect((await errorOf(signIn(email))).name).toBe("UserNotConfirmedException");
    // 違うコードは CodeMismatchException
    expect((await errorOf(confirmSignUp(email, "000000"))).name).toBe("CodeMismatchException");
  });

  it("管理の確認では、メールは「確認済み」にならない(アプリは確認済みのメールでしか users と結びつけない)", async () => {
    const email = await confirmedUser("admin-confirm");
    const u = await client.send(new AdminGetUserCommand({ UserPoolId: poolId, Username: email }));
    expect(u.UserStatus).toBe("CONFIRMED");
    expect(u.UserAttributes?.find((a) => a.Name === "email_verified")?.Value ?? "false").toBe(
      "false",
    );
  });
});

describe(`Cognito の契約(${TARGET}): ログインと二段階認証`, () => {
  it("ログインすると、署名つきの ID トークン(発行元・宛先・種類・メール)が返る", async () => {
    const email = await confirmedUser("login");
    const r = await signIn(email);
    const idToken = r.AuthenticationResult?.IdToken ?? "";
    const claims = await verifiedClaims(idToken);
    expect(claims).toMatchObject({ iss: issuer, aud: clientId, token_use: "id", email });
    expect(typeof claims.sub).toBe("string");
    // email_verified は真偽値(文字列ではない)
    expect(claims.email_verified).toBe(false);
  });

  it("パスワード違いと、いない人は、同じ NotAuthorizedException・同じ文(登録の有無が分からない)", async () => {
    const email = await confirmedUser("wrong");
    const wrong = await errorOf(signIn(email, "Wrong-Password-999"));
    const nobody = await errorOf(signIn(emailFor("nobody"), "Wrong-Password-999"));
    expect(wrong.name).toBe("NotAuthorizedException");
    expect(nobody).toEqual(wrong);
  });

  it("いない人の再設定も、送ったような答え。いない人の確認コードは CodeMismatchException", async () => {
    const r = await client.send(
      new ForgotPasswordCommand({ ClientId: clientId, Username: emailFor("ghost") }),
    );
    expect(r.CodeDeliveryDetails?.DeliveryMedium).toBe("EMAIL");
    const e = await errorOf(confirmSignUp(emailFor("ghost2"), "123456"));
    expect(e.name).toBe("CodeMismatchException");
  });

  it("二段階認証(TOTP): 設定するとログインでコードを聞かれ、正しいコードで ID トークンが返る", {
    timeout: 90_000,
  }, async () => {
    const email = await confirmedUser("mfa");
    const first = await signIn(email);
    const accessToken = first.AuthenticationResult?.AccessToken ?? "";
    const { SecretCode = "" } = await client.send(
      new AssociateSoftwareTokenCommand({ AccessToken: accessToken }),
    );
    const verified = await client.send(
      new VerifySoftwareTokenCommand({
        AccessToken: accessToken,
        UserCode: totp(SecretCode, clock()),
      }),
    );
    expect(verified.Status).toBe("SUCCESS");
    await client.send(
      new SetUserMFAPreferenceCommand({
        AccessToken: accessToken,
        SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true },
      }),
    );

    const challenged = await signIn(email);
    expect(challenged.ChallengeName).toBe("SOFTWARE_TOKEN_MFA");
    expect(challenged.AuthenticationResult).toBeUndefined();
    const wrong = await errorOf(answerMfa(challenged.Session, email, "000000"));
    expect(wrong.name).toBe("CodeMismatchException");

    await nextTotpWindow();
    // 間違えた札では、正しいコードでも通らない(アプリは途中の札を1回きりとして扱う。apps/api の auth/cognito-routes.ts)
    const reused = await errorOf(answerMfa(challenged.Session, email, totp(SecretCode, clock())));
    expect(reused.name).toBe("NotAuthorizedException");

    await nextTotpWindow();
    const again = await signIn(email);
    const done = await answerMfa(again.Session, email, totp(SecretCode, clock()));
    const claims = await verifiedClaims(done.AuthenticationResult?.IdToken ?? "");
    expect(claims).toMatchObject({ token_use: "id", email });
  });
});

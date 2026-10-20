import { createPublicKey, type JsonWebKey, randomUUID, verify } from "node:crypto";
import {
  AdminConfirmSignUpCommand,
  AdminDeleteUserCommand,
  CognitoIdentityProviderClient,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  SignUpCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { afterAll, beforeAll, expect } from "vitest";
import { FakeCognito } from "../src/fake.ts";
import { serve } from "../src/serve.ts";

// ─────────────────────────────────────────────────────────────────────────────
// 契約テストの共通の部品(つなぎ先・試しの人・よく使う呼び出し)。テストは *.contract.test.ts。
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

export const REAL = process.env.COGNITO_CONTRACT_TARGET === "real";
const env = process.env;

export let client: CognitoIdentityProviderClient;
export let issuer: string;
export let poolId: string;
export let clientId: string;
let close: (() => Promise<void>) | undefined;
// 偽物の時計。偽物に流すときは、二段階認証のコードの切り替わり(30秒)を待たずに時計を進める
export let skew = 0;
/** 偽物に流すときだけある(本物では確認コードのメールを読めないので undefined) */
export let fake: FakeCognito | undefined;
export const clock = () => Date.now() + skew;

// 本物では SES の試し用の宛先(サンドボックスでも送れて、どこにも届かない)
const runId = `${Date.now()}${randomUUID().slice(0, 4)}`;
export const emailFor = (label: string) =>
  REAL
    ? `success+contract-${label}-${runId}@simulator.amazonses.com`
    : `contract-${label}-${runId}@example.test`;
// 試しの人のパスワード(終わったら人ごと消す。本物の秘密ではない)
// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_password
export const PASSWORD = "Contract-Test-1234";
export const created: string[] = [];

/** 各テストファイルの先頭で1回呼ぶ(偽物を立てる / 本物につなぐ・終わったら試しの人を消す) */
export function useContractTarget() {
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
}

export const signUp = (email: string, password = PASSWORD) =>
  client.send(
    new SignUpCommand({
      ClientId: clientId,
      Username: email,
      Password: password,
      UserAttributes: [{ Name: "email", Value: email }],
    }),
  );

export const confirmSignUp = (email: string, code: string) =>
  client.send(
    new ConfirmSignUpCommand({ ClientId: clientId, Username: email, ConfirmationCode: code }),
  );

/** 二段階認証のコードを答える */
export const answerMfa = (session: string | undefined, email: string, code: string) =>
  client.send(
    new RespondToAuthChallengeCommand({
      ClientId: clientId,
      ChallengeName: "SOFTWARE_TOKEN_MFA",
      Session: session,
      ChallengeResponses: { USERNAME: email, SOFTWARE_TOKEN_MFA_CODE: code },
    }),
  );

/** 登録して、管理の確認で「確認済み」にした人を作る(本物では確認コードのメールを読めないため) */
export async function confirmedUser(label: string) {
  const email = emailFor(label);
  await signUp(email);
  created.push(email);
  await client.send(new AdminConfirmSignUpCommand({ UserPoolId: poolId, Username: email }));
  return email;
}

export const signIn = (email: string, password = PASSWORD) =>
  client.send(
    new InitiateAuthCommand({
      ClientId: clientId,
      AuthFlow: "USER_PASSWORD_AUTH",
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }),
  );

export const errorOf = (p: Promise<unknown>) =>
  p.then(
    () => ({ name: "(成功した)", message: "" }),
    (e: Error) => ({ name: e.name, message: e.message }),
  );

/** ID トークンの署名を、発行元の公開鍵で確かめて中身を返す */
export async function verifiedClaims(idToken: string): Promise<Record<string, unknown>> {
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
export const nextTotpWindow = async () => {
  if (!REAL) {
    skew += 30_000;
    return;
  }
  await new Promise((r) => setTimeout(r, 30_000 - (Date.now() % 30_000) + 500));
};

export const TARGET = REAL ? "stg の本物" : "偽物";

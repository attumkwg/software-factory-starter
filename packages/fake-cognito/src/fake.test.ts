import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FakeCognito } from "./fake.ts";

// 偽物の受け口の細かい所(契約テストが通らない道: 入口の振り分け・知らない操作・再設定の流れ)。
// 本物と同じかは contract/ が確かめる。

const clientId = "unit-client";
// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_username -- 試しのプールの名前で、ユーザー名ではない
const userPoolId = "local_unitpool";
// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_password
const PASSWORD = "Unit-Test-1234";

const fake = () => new FakeCognito({ baseUrl: "http://fake", userPoolId, clientId });

async function send(f: FakeCognito, action: string, body: Record<string, unknown>) {
  const res = await f.fetch(
    new Request("http://fake/", {
      method: "POST",
      headers: { "x-amz-target": `AWSCognitoIdentityProviderService.${action}` },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** IdP をつないで、アプリクライアントの一覧に足した偽物 */
async function withIdp() {
  const f = fake();
  const create = await send(f, "CreateIdentityProvider", {
    UserPoolId: userPoolId,
    ProviderName: "org-test",
    ProviderType: "SAML",
    ProviderDetails: { MetadataURL: "https://idp.example.test/metadata.xml" },
    AttributeMapping: { email: "email" },
  });
  expect(create.status).toBe(200);
  const update = await send(f, "UpdateUserPoolClient", {
    UserPoolId: userPoolId,
    ClientId: clientId,
    SupportedIdentityProviders: ["COGNITO", "org-test"],
  });
  expect(update.status).toBe(200);
  return f;
}

const VERIFIER = "v".repeat(43);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const authorizeUrl = (provider = "org-test") =>
  `http://fake/oauth2/authorize?${new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: "http://app/api/auth/sso/callback",
    identity_provider: provider,
    state: "s1",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
  })}`;

const token = (f: FakeCognito, code: string, verifier = VERIFIER) =>
  f.fetch(
    new Request("http://fake/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        redirect_uri: "http://app/api/auth/sso/callback",
        code_verifier: verifier,
      }).toString(),
    }),
  );

describe("偽物の SSO(OAuth の入口とテスト用の IdP)", () => {
  it("authorize はテスト用の IdP の画面。メールを入れると、コードと state を付けて戻り先へ", async () => {
    const f = await withIdp();
    const page = await f.fetch(new Request(authorizeUrl()));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("テスト用の IdP");
    const form = new URLSearchParams(new URL(authorizeUrl()).search);
    form.set("email", "Taro@Corp.test");
    const back = await f.fetch(
      new Request("http://fake/fake-idp/sign-in", { method: "POST", body: form.toString() }),
    );
    expect(back.status).toBe(302);
    const location = new URL(back.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe("http://app/api/auth/sso/callback");
    expect(location.searchParams.get("state")).toBe("s1");
    const res = await token(f, location.searchParams.get("code") ?? "");
    const { id_token } = (await res.json()) as { id_token: string };
    const claims = JSON.parse(Buffer.from(id_token.split(".")[1] ?? "", "base64url").toString());
    expect(claims.email).toBe("taro@corp.test");
    expect(claims.identities[0].providerName).toBe("org-test");
    expect(claims.email_verified).toBeUndefined();
  });

  it("つないでいない・一覧に無い IdP は 400。コードは1回きりで、PKCE が違えば invalid_grant", async () => {
    const f = await withIdp();
    expect((await f.fetch(new Request(authorizeUrl("org-other")))).status).toBe(400);
    const code = f.issueSsoCode(authorizeUrl(), "a@corp.test");
    expect((await token(f, code, "wrong".repeat(9))).status).toBe(400);
    const again = f.issueSsoCode(authorizeUrl(), "a@corp.test");
    expect((await token(f, again)).status).toBe(200);
    const reused = await token(f, again);
    expect(((await reused.json()) as { error: string }).error).toBe("invalid_grant");
  });

  it("アプリクライアントが使っている IdP は消せない。一覧から外せば消せる", async () => {
    const f = await withIdp();
    const inUse = await send(f, "DeleteIdentityProvider", {
      UserPoolId: userPoolId,
      ProviderName: "org-test",
    });
    expect(inUse.status).toBe(400);
    await send(f, "UpdateUserPoolClient", {
      UserPoolId: userPoolId,
      ClientId: clientId,
      SupportedIdentityProviders: ["COGNITO"],
    });
    const removed = await send(f, "DeleteIdentityProvider", {
      UserPoolId: userPoolId,
      ProviderName: "org-test",
    });
    expect(removed.status).toBe(200);
    const unknown = await send(f, "UpdateUserPoolClient", {
      UserPoolId: userPoolId,
      ClientId: clientId,
      SupportedIdentityProviders: ["COGNITO", "org-test"],
    });
    expect(unknown.status).toBe(400);
  });
});

describe("偽物の Cognito の受け口", () => {
  it("公開鍵・healthz を GET で返し、それ以外の道は 404", async () => {
    const f = fake();
    const jwks = await f.fetch(new Request(`http://fake/${userPoolId}/.well-known/jwks.json`));
    expect(((await jwks.json()) as { keys: unknown[] }).keys).toHaveLength(1);
    expect(await (await f.fetch(new Request("http://fake/healthz"))).text()).toBe("ok");
    expect((await f.fetch(new Request("http://fake/other"))).status).toBe(404);
  });

  it("知らない操作・違うクライアント・違うプールは 400 と型の名前", async () => {
    const f = fake();
    expect((await send(f, "ListUsers", {})).body.__type).toBe("InvalidAction");
    // Object の持ち物の名前も「知らない操作」(振り分けの表を素通りしない)
    expect((await send(f, "toString", {})).body.__type).toBe("InvalidAction");
    const wrongClient = await send(f, "SignUp", { ClientId: "other" });
    expect(wrongClient).toMatchObject({
      status: 400,
      body: { __type: "ResourceNotFoundException" },
    });
    const wrongPool = await send(f, "AdminGetUser", { UserPoolId: "other", Username: "a@b.test" });
    expect(wrongPool.body.__type).toBe("ResourceNotFoundException");
  });

  it("確認コードの再送: いない人にも送ったような答え。確認済みの人は断る", async () => {
    const f = fake();
    const nobody = await send(f, "ResendConfirmationCode", {
      ClientId: clientId,
      Username: "no@x.test",
    });
    expect(nobody.body.CodeDeliveryDetails).toEqual({
      Destination: "n***@x***",
      DeliveryMedium: "EMAIL",
      AttributeName: "email",
    });
    await send(f, "SignUp", { ClientId: clientId, Username: "me@x.test", Password: PASSWORD });
    const resent = await send(f, "ResendConfirmationCode", {
      ClientId: clientId,
      Username: "me@x.test",
    });
    expect(resent.body.CodeDeliveryDetails).toMatchObject({ Destination: "m***@x***" });
    expect(f.lastCode("me@x.test")).toMatch(/^\d{6}$/);
    await send(f, "AdminConfirmSignUp", { UserPoolId: userPoolId, Username: "me@x.test" });
    const again = await send(f, "ResendConfirmationCode", {
      ClientId: clientId,
      Username: "me@x.test",
    });
    expect(again.body.__type).toBe("InvalidParameterException");
  });

  it("再設定: 届いたコードで新しいパスワードにすると、古いパスワードでは入れない", async () => {
    const f = fake();
    const email = "reset@x.test";
    await send(f, "SignUp", { ClientId: clientId, Username: email, Password: PASSWORD });
    await send(f, "AdminConfirmSignUp", { UserPoolId: userPoolId, Username: email });
    await send(f, "ForgotPassword", { ClientId: clientId, Username: email });
    const next = "Unit-Test-5678";
    const confirmed = await send(f, "ConfirmForgotPassword", {
      ClientId: clientId,
      Username: email,
      ConfirmationCode: f.lastCode(email),
      Password: next,
    });
    expect(confirmed.status).toBe(200);
    const signIn = (password: string) =>
      send(f, "InitiateAuth", {
        ClientId: clientId,
        AuthFlow: "USER_PASSWORD_AUTH",
        AuthParameters: { USERNAME: email, PASSWORD: password },
      });
    expect((await signIn(PASSWORD)).body.__type).toBe("NotAuthorizedException");
    expect((await signIn(next)).body.AuthenticationResult).toBeDefined();
  });

  it("管理の削除のあとは、その人はいない", async () => {
    const f = fake();
    const email = "gone@x.test";
    await send(f, "SignUp", { ClientId: clientId, Username: email, Password: PASSWORD });
    expect(
      (await send(f, "AdminDeleteUser", { UserPoolId: userPoolId, Username: email })).status,
    ).toBe(200);
    const after = await send(f, "AdminGetUser", { UserPoolId: userPoolId, Username: email });
    expect(after.body.__type).toBe("UserNotFoundException");
  });
});

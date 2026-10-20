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

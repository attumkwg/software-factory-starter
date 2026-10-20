import {
  AssociateSoftwareTokenCommand,
  ChangePasswordCommand,
  GetUserCommand,
  GlobalSignOutCommand,
  SetUserMFAPreferenceCommand,
  UpdateUserAttributesCommand,
  VerifySoftwareTokenCommand,
  VerifyUserAttributeCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { describe, expect, it } from "vitest";
import { totp } from "../src/fake.ts";
import {
  client,
  clock,
  confirmedUser,
  emailFor,
  errorOf,
  fake,
  nextTotpWindow,
  PASSWORD,
  REAL,
  signIn,
  TARGET,
  useContractTarget,
} from "./harness.ts";

// 契約テスト(ログインした本人の操作)。アプリの「アカウント」の画面が頼っている振る舞い
// (docs/designs/0006-account-security.md の 5)。アクセストークンは、パスワードを入れ直して得た物。

useContractTarget();

/** 確認済みの人を作ってログインし、アクセストークンを返す */
async function loggedIn(label: string) {
  const email = await confirmedUser(label);
  const r = await signIn(email);
  return { email, token: r.AuthenticationResult?.AccessToken ?? "" };
}

const getUser = (token: string) => client.send(new GetUserCommand({ AccessToken: token }));

describe(`Cognito の契約(${TARGET}): 本人の操作(パスワード)`, () => {
  it("パスワードの変更: 前のパスワードが違えば NotAuthorizedException。変えたら新しいパスワードで入れる", async () => {
    const { email, token } = await loggedIn("chpw");
    // 試しの人の新しいパスワード(終わったら人ごと消す。本物の秘密ではない)
    // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_password
    const newPassword = "Contract-Changed-5678";
    const wrong = await errorOf(
      client.send(
        new ChangePasswordCommand({
          AccessToken: token,
          PreviousPassword: "Not-The-Password-1",
          ProposedPassword: newPassword,
        }),
      ),
    );
    expect(wrong.name).toBe("NotAuthorizedException");
    const weak = await errorOf(
      client.send(
        new ChangePasswordCommand({
          AccessToken: token,
          PreviousPassword: PASSWORD,
          ProposedPassword: "short",
        }),
      ),
    );
    expect(weak.name).toBe("InvalidPasswordException");
    await client.send(
      new ChangePasswordCommand({
        AccessToken: token,
        PreviousPassword: PASSWORD,
        ProposedPassword: newPassword,
      }),
    );
    expect((await errorOf(signIn(email))).name).toBe("NotAuthorizedException");
    expect((await signIn(email, newPassword)).AuthenticationResult?.AccessToken).toBeTruthy();
  });
});

describe(`Cognito の契約(${TARGET}): 本人の操作(メール)`, () => {
  it("メールの変更: 新しいメールに確認コードが行き、確認するまでは古いメールのまま", async () => {
    const { email, token } = await loggedIn("chmail");
    const next = emailFor("chmail-new");
    const r = await client.send(
      new UpdateUserAttributesCommand({
        AccessToken: token,
        UserAttributes: [{ Name: "email", Value: next }],
      }),
    );
    expect(r.CodeDeliveryDetailsList?.[0]).toMatchObject({
      DeliveryMedium: "EMAIL",
      AttributeName: "email",
    });
    // 確認する前: 古いメールで入れる・新しいメールでは入れない
    expect((await signIn(email)).AuthenticationResult).toBeDefined();
    expect((await errorOf(signIn(next))).name).toBe("NotAuthorizedException");
    const attrs = (await getUser(token)).UserAttributes ?? [];
    expect(attrs.find((a) => a.Name === "email")?.Value).toBe(email);
    // 違うコード
    const wrong = await errorOf(
      client.send(
        new VerifyUserAttributeCommand({
          AccessToken: token,
          AttributeName: "email",
          Code: "000000",
        }),
      ),
    );
    expect(wrong.name).toBe("CodeMismatchException");
  });

  it.skipIf(REAL)(
    "【偽物だけ。本物は確認コードのメールを読めない】正しいコードで替わり、新しいメールで入れる",
    async () => {
      const { email, token } = await loggedIn("chmail-ok");
      const next = emailFor("chmail-ok-new");
      await client.send(
        new UpdateUserAttributesCommand({
          AccessToken: token,
          UserAttributes: [{ Name: "email", Value: next }],
        }),
      );
      const code = fake?.lastCode(next) ?? "";
      await client.send(
        new VerifyUserAttributeCommand({ AccessToken: token, AttributeName: "email", Code: code }),
      );
      expect((await errorOf(signIn(email))).name).toBe("NotAuthorizedException");
      expect((await signIn(next)).AuthenticationResult).toBeDefined();
    },
  );

  it("ほかの人が使っているメールへの変更は、申し込みか確認の時点で AliasExistsException(アプリはどちらでも同じ答え)", async () => {
    const { token } = await loggedIn("alias");
    const other = await confirmedUser("alias-other");
    const r = await errorOf(
      client.send(
        new UpdateUserAttributesCommand({
          AccessToken: token,
          UserAttributes: [{ Name: "email", Value: other }],
        }),
      ),
    );
    // 本物がどちらの時点で断るかを、ここで記録する(成功なら確認の時点で断る)
    expect(["AliasExistsException", "(成功した)"]).toContain(r.name);
  });
});

describe(`Cognito の契約(${TARGET}): 本人の操作(トークンと二段階認証)`, () => {
  it("GlobalSignOut の後は、そのアクセストークンで本人の操作ができない", async () => {
    const { token } = await loggedIn("signout");
    expect((await getUser(token)).Username).toBeTruthy();
    await client.send(new GlobalSignOutCommand({ AccessToken: token }));
    expect((await errorOf(getUser(token))).name).toBe("NotAuthorizedException");
  });

  it("二段階認証: 鍵を作り直すと前の鍵のコードは通らない。有効にすると GetUser に出る", {
    timeout: 90_000,
  }, async () => {
    const { token } = await loggedIn("totp");
    expect((await getUser(token)).UserMFASettingList ?? []).toEqual([]);
    const first = await client.send(new AssociateSoftwareTokenCommand({ AccessToken: token }));
    const second = await client.send(new AssociateSoftwareTokenCommand({ AccessToken: token }));
    const stale = await errorOf(
      client.send(
        new VerifySoftwareTokenCommand({
          AccessToken: token,
          UserCode: totp(first.SecretCode ?? "", clock()),
        }),
      ),
    );
    expect(["EnableSoftwareTokenMFAException", "CodeMismatchException"]).toContain(stale.name);
    await nextTotpWindow();
    const ok = await client.send(
      new VerifySoftwareTokenCommand({
        AccessToken: token,
        UserCode: totp(second.SecretCode ?? "", clock()),
      }),
    );
    expect(ok.Status).toBe("SUCCESS");
    await client.send(
      new SetUserMFAPreferenceCommand({
        AccessToken: token,
        SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true },
      }),
    );
    expect((await getUser(token)).UserMFASettingList).toContain("SOFTWARE_TOKEN_MFA");
  });
});

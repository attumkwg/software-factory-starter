import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { CognitoVerifier } from "../../src/auth/providers.ts";

// 本物の Cognito にはつながず、手元で作った鍵で「検証の仕方」が正しいかを確かめる。

const settings = {
  region: "ap-northeast-1",
  userPoolId: "ap-northeast-1_test",
  clientId: "client-1",
};
const issuer = `https://cognito-idp.${settings.region}.amazonaws.com/${settings.userPoolId}`;

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let verifier: CognitoVerifier;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
  verifier = new CognitoVerifier(settings, createLocalJWKSet({ keys: [jwk] }));
});

const sign = (claims: Record<string, unknown>, opts: { aud?: string; iss?: string } = {}) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? issuer)
    .setAudience(opts.aud ?? settings.clientId)
    .setSubject("user-sub-1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

describe("Cognito の ID トークンの検証", () => {
  it("正しい ID トークンなら sub を返す", async () => {
    expect(await verifier.verify(await sign({ token_use: "id" }))).toEqual({
      kind: "external",
      externalId: "user-sub-1",
    });
  });

  it("アクセストークンは受け付けない", async () => {
    expect(await verifier.verify(await sign({ token_use: "access" }))).toBeNull();
  });

  it("別のアプリ宛て・別の発行元は受け付けない", async () => {
    expect(await verifier.verify(await sign({ token_use: "id" }, { aud: "other" }))).toBeNull();
    expect(
      await verifier.verify(await sign({ token_use: "id" }, { iss: "https://evil.example" })),
    ).toBeNull();
  });

  it("壊れたトークンは受け付けない", async () => {
    expect(await verifier.verify("not-a-jwt")).toBeNull();
  });
});

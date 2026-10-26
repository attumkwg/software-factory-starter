import { type Body, CognitoFault, type UserPool } from "../pool.ts";

// IdP のつなぎ(CreateIdentityProvider など)と、アプリクライアントの IdP の一覧。運営のコマンド sso-connect が使う。
// 署名は確かめない(管理の入口と同じ)。偽物は SAML のメタデータを読みに行かない(本物は stg で人が確かめる。設計書 0056 の U-8)

const text = (v: unknown) => (typeof v === "string" ? v : "");

const strings = (v: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries(typeof v === "object" && v !== null ? v : {}).map(([k, x]) => [k, text(x)]),
  );

export function createIdentityProvider(pool: UserPool, b: Body) {
  pool.requirePool(b);
  const name = text(b.ProviderName);
  // 本物の決まりより狭い(英数字と . _ -・32文字まで)。アプリが付ける名前(org-<組織の ID の頭>)は通る
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(name)) {
    throw new CognitoFault("InvalidParameterException", "ProviderName is invalid.");
  }
  if (pool.identityProviders.has(name)) {
    throw new CognitoFault(
      "DuplicateProviderException",
      "A provider with the name already exists.",
    );
  }
  if (b.ProviderType !== "SAML") {
    throw new CognitoFault("InvalidParameterException", "偽物は SAML だけを扱います");
  }
  const details = strings(b.ProviderDetails);
  if (!details.MetadataURL && !details.MetadataFile) {
    throw new CognitoFault("InvalidParameterException", "MetadataURL or MetadataFile is required.");
  }
  const provider = { type: "SAML", details, attributeMapping: strings(b.AttributeMapping) };
  pool.identityProviders.set(name, provider);
  return { IdentityProvider: describe(pool, name) };
}

export function describeIdentityProvider(pool: UserPool, b: Body) {
  pool.requirePool(b);
  return { IdentityProvider: describe(pool, text(b.ProviderName)) };
}

export function deleteIdentityProvider(pool: UserPool, b: Body) {
  pool.requirePool(b);
  const name = text(b.ProviderName);
  describe(pool, name);
  // 本物と同じく、アプリクライアントが使っている IdP は消せない(先に一覧から外す)
  if (pool.supportedIdentityProviders.includes(name)) {
    throw new CognitoFault("UnsupportedIdentityProviderException", "The provider is in use.");
  }
  pool.identityProviders.delete(name);
  return {};
}

export function describeUserPoolClient(pool: UserPool, b: Body) {
  pool.requirePool(b);
  pool.requireClient(b);
  return {
    UserPoolClient: {
      UserPoolId: pool.id,
      ClientId: pool.clientId,
      ClientName: "fake-web",
      ExplicitAuthFlows: ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
      SupportedIdentityProviders: [...pool.supportedIdentityProviders],
      AllowedOAuthFlows: ["code"],
      AllowedOAuthScopes: ["openid", "email"],
      AllowedOAuthFlowsUserPoolClient: true,
      PreventUserExistenceErrors: "ENABLED",
    },
  };
}

export function updateUserPoolClient(pool: UserPool, b: Body) {
  pool.requirePool(b);
  pool.requireClient(b);
  const list = Array.isArray(b.SupportedIdentityProviders)
    ? b.SupportedIdentityProviders.map(text)
    : ["COGNITO"];
  const unknown = list.filter((n) => n !== "COGNITO" && !pool.identityProviders.has(n));
  if (unknown.length > 0) {
    throw new CognitoFault(
      "InvalidParameterException",
      `The provider ${unknown[0]} does not exist for User Pool ${pool.id}`,
    );
  }
  pool.supportedIdentityProviders = list;
  return describeUserPoolClient(pool, b);
}

function describe(pool: UserPool, name: string) {
  const p = pool.identityProviders.get(name);
  if (!p) throw new CognitoFault("ResourceNotFoundException", "Identity provider does not exist.");
  return {
    UserPoolId: pool.id,
    ProviderName: name,
    ProviderType: p.type,
    ProviderDetails: p.details,
    AttributeMapping: p.attributeMapping,
  };
}

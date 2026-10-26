import {
  CognitoIdentityProviderClient,
  CreateIdentityProviderCommand,
  DeleteIdentityProviderCommand,
  DescribeUserPoolClientCommand,
  UpdateUserPoolClientCommand,
  type UserPoolClientType,
} from "@aws-sdk/client-cognito-identity-provider";
import { MANUAL_AUDIT_ACTIONS, recordAudit } from "../audit/index.ts";
import type { RootDb } from "../db/client.ts";
import { withTenant } from "../db/tenant.ts";
import {
  deleteSsoConnection,
  findSsoConnectState,
  insertSsoConnection,
} from "../domains/organizations/index.ts";

// 運営のコマンド sso-connect・sso-disconnect(docs/designs/0056-sso-scim-ip-audit-export.md の 5・U-1・
// docs/runbooks/sso.md の 4)。お客さんの情シスから受け取った SAML のメタデータの URL で、Cognito に IdP を作り、
// アプリクライアントの一覧に足し、organizations.sso_connections に1行。外すのは逆の順(先に DB で止める)。
// 本番の Cognito と DB に書くので人が打つ。--execute が無ければ、確かめて何をするかを出すだけ(試し)。

/**
 * Cognito の IdP の名前(32文字まで)。組織の ID の**後ろ** 20 桁(UUID v7 の頭は時刻なので、近い時刻に作った組織で重なる)。
 * 名前やドメインを入れない(CloudTrail に残るため)
 */
export const providerNameFor = (tenantId: string) =>
  `org-${tenantId.replaceAll("-", "").slice(-20)}`;

/** SAML の主張のうち、メールの属性(Entra ID・Okta・Google Workspace でよく使う名前。違う IdP は --email-attribute で) */
const DEFAULT_EMAIL_ATTRIBUTE =
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress";

export type CognitoTarget = {
  client: CognitoIdentityProviderClient;
  userPoolId: string;
  clientId: string;
};

/** 環境変数(API と同じ COGNITO_*)からつなぐ。手元は偽物(COGNITO_ENDPOINT)へ */
export function cognitoTargetFromEnv(env = process.env): CognitoTarget {
  const { COGNITO_REGION, COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, COGNITO_ENDPOINT } = env;
  if (!(COGNITO_REGION && COGNITO_USER_POOL_ID && COGNITO_CLIENT_ID)) {
    throw new Error("COGNITO_REGION / COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID が要ります");
  }
  const fake = COGNITO_ENDPOINT
    ? {
        endpoint: COGNITO_ENDPOINT,
        credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
      }
    : {};
  const client = new CognitoIdentityProviderClient({ region: COGNITO_REGION, ...fake });
  return { client, userPoolId: COGNITO_USER_POOL_ID, clientId: COGNITO_CLIENT_ID };
}

export type ConnectInput = {
  tenantId: string;
  metadataUrl: string;
  emailAttribute?: string | undefined;
  execute: boolean;
};

export async function connectSso(db: RootDb, cognito: CognitoTarget, input: ConnectInput) {
  const url = new URL(input.metadataUrl);
  if (url.protocol !== "https:") throw new Error("メタデータの URL は https:// にしてください");
  const providerName = providerNameFor(input.tenantId);
  const state = await withTenant(db, input.tenantId, (tx) =>
    findSsoConnectState(tx, input.tenantId),
  );
  // T-8: 確かめたドメインが無い組織には、つながない(他社のメールを名乗れる IdP にしない)
  if (state.verifiedDomains === 0) {
    throw new Error("この組織には DNS で確かめたドメインがありません(先に画面で確かめてもらう)");
  }
  if (state.providerName) throw new Error(`もうつないであります(${state.providerName})`);
  const plan = { providerName, verifiedDomains: state.verifiedDomains, metadataHost: url.host };
  if (!input.execute) return { mode: "plan" as const, ...plan };

  await cognito.client.send(
    new CreateIdentityProviderCommand({
      UserPoolId: cognito.userPoolId,
      ProviderName: providerName,
      ProviderType: "SAML",
      ProviderDetails: { MetadataURL: input.metadataUrl },
      AttributeMapping: { email: input.emailAttribute ?? DEFAULT_EMAIL_ATTRIBUTE },
    }),
  );
  await setClientProviders(cognito, (list) => [...new Set([...list, providerName])]);
  await withTenant(db, input.tenantId, async (tx) => {
    await insertSsoConnection(tx, input.tenantId, providerName);
    await recordAudit(tx, {
      tenantId: input.tenantId,
      actor: { kind: "system", id: null },
      action: MANUAL_AUDIT_ACTIONS.ssoConnect,
      outcome: "allowed",
    });
  });
  return { mode: "connected" as const, ...plan };
}

export async function disconnectSso(
  db: RootDb,
  cognito: CognitoTarget,
  input: { tenantId: string; execute: boolean },
) {
  const state = await withTenant(db, input.tenantId, (tx) =>
    findSsoConnectState(tx, input.tenantId),
  );
  const providerName = state.providerName;
  if (!providerName) throw new Error("この組織には IdP がつないでありません");
  if (!input.execute) return { mode: "plan" as const, providerName };
  // 先に DB で止める(戻ってきても入れない)。Cognito の掃除が途中で落ちたら removeFromCognito で続きを
  await withTenant(db, input.tenantId, async (tx) => {
    await deleteSsoConnection(tx, input.tenantId);
    await recordAudit(tx, {
      tenantId: input.tenantId,
      actor: { kind: "system", id: null },
      action: MANUAL_AUDIT_ACTIONS.ssoDisconnect,
      outcome: "allowed",
    });
  });
  await removeFromCognito(cognito, providerName);
  return { mode: "disconnected" as const, providerName };
}

/** Cognito から外す(一覧から外してから IdP を消す。無ければ何もしない) */
export async function removeFromCognito(cognito: CognitoTarget, providerName: string) {
  await setClientProviders(cognito, (list) => list.filter((n) => n !== providerName));
  try {
    await cognito.client.send(
      new DeleteIdentityProviderCommand({
        UserPoolId: cognito.userPoolId,
        ProviderName: providerName,
      }),
    );
  } catch (e) {
    if ((e as { name?: string }).name !== "ResourceNotFoundException") throw e;
  }
}

/**
 * アプリクライアントの IdP の一覧を変える。UpdateUserPoolClient は**渡さなかった項目を既定に戻す**ので、
 * いまの設定を読んで、変えられる項目を全部渡し直す(Terraform は supported_identity_providers を見ない)
 */
async function setClientProviders(cognito: CognitoTarget, change: (list: string[]) => string[]) {
  const { UserPoolClient: current } = await cognito.client.send(
    new DescribeUserPoolClientCommand({
      UserPoolId: cognito.userPoolId,
      ClientId: cognito.clientId,
    }),
  );
  if (!current) throw new Error("アプリクライアントが見つかりません");
  const list = change(current.SupportedIdentityProviders ?? ["COGNITO"]);
  await cognito.client.send(
    new UpdateUserPoolClientCommand({
      ...updatable(current),
      UserPoolId: cognito.userPoolId,
      ClientId: cognito.clientId,
      SupportedIdentityProviders: list,
    }),
  );
}

/** UpdateUserPoolClient に渡し直す項目(読むだけの項目・秘密は渡さない) */
function updatable(c: UserPoolClientType) {
  return {
    ClientName: c.ClientName,
    RefreshTokenValidity: c.RefreshTokenValidity,
    AccessTokenValidity: c.AccessTokenValidity,
    IdTokenValidity: c.IdTokenValidity,
    TokenValidityUnits: c.TokenValidityUnits,
    ReadAttributes: c.ReadAttributes,
    WriteAttributes: c.WriteAttributes,
    ExplicitAuthFlows: c.ExplicitAuthFlows,
    CallbackURLs: c.CallbackURLs,
    LogoutURLs: c.LogoutURLs,
    DefaultRedirectURI: c.DefaultRedirectURI,
    AllowedOAuthFlows: c.AllowedOAuthFlows,
    AllowedOAuthScopes: c.AllowedOAuthScopes,
    AllowedOAuthFlowsUserPoolClient: c.AllowedOAuthFlowsUserPoolClient,
    AnalyticsConfiguration: c.AnalyticsConfiguration,
    PreventUserExistenceErrors: c.PreventUserExistenceErrors,
    EnableTokenRevocation: c.EnableTokenRevocation,
    EnablePropagateAdditionalUserContextData: c.EnablePropagateAdditionalUserContextData,
    AuthSessionValidity: c.AuthSessionValidity,
    RefreshTokenRotation: c.RefreshTokenRotation,
  };
}

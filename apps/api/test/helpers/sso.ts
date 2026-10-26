import { serve } from "@app/fake-cognito";
import type { PlanDefinition, SsoStartResult } from "@app/shared";
import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { v7 as uuidv7 } from "uuid";
import { expect } from "vitest";
import type { RootDb } from "../../src/db/client.ts";
import { withTenant } from "../../src/db/tenant.ts";
import { domains } from "../../src/domains/organizations/schema.ts";
import { setPlan } from "../../src/plans/index.ts";
import { type CognitoTarget, connectSso } from "../../src/sso/connect.ts";
import { type CognitoApp, cookieOf, createCognitoApp } from "./cognito.ts";
import { call, createTenantFixture, type TenantFixture } from "./fixtures.ts";

// SSO の結合テストの組み立て(docs/designs/0056-sso-scim-ip-audit-export.md)。
// 偽物の Cognito の OAuth の入口と「テスト用の IdP」を使い、運営のコマンド(AWS の SDK)には同じ偽物を HTTP で立てる。

export const PLANS: PlanDefinition[] = [
  { id: "standard", label: "スタンダード", features: [] },
  { id: "enterprise", label: "エンタープライズ", features: ["sso", "ip-allowlist"] },
];
export const PRICE_LISTS = [{ id: "2026-10", effectiveFrom: "2026-10-01", description: "最初" }];
export const APP_URL = "http://localhost:8080";
export const OAUTH = "http://fake-cognito.test";
export const METADATA = "https://idp.example.test/metadata.xml";

export type SsoContext = {
  t: CognitoApp;
  cognito: CognitoTarget;
  owner: RootDb;
  close: () => Promise<void>;
};

export async function createSsoContext(appUrl: string, owner: RootDb): Promise<SsoContext> {
  const t = createCognitoApp(appUrl, { COGNITO_OAUTH_URL: OAUTH, APP_URL }, { plans: PLANS });
  const server = await serve((req) => t.fake.fetch(req), 0);
  const cognito = {
    client: new CognitoIdentityProviderClient({
      region: "ap-northeast-1",
      endpoint: server.url,
      credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
    }),
    userPoolId: "local_fakepool",
    clientId: "local-web-client",
  };
  const close = async () => {
    await server.close();
    await t.pool.end();
  };
  return { t, cognito, owner, close };
}

let seq = 0;

export const enterprise = (ctx: SsoContext, tenantId: string, plan = "enterprise") =>
  setPlan(
    ctx.owner,
    tenantId,
    { plan, seats: null },
    { plans: PLANS, priceLists: PRICE_LISTS, execute: true },
  );

/** プランに sso を入れ、ドメイン(fixture のメールのドメイン)を確かめ済みにし、運営のコマンドで IdP をつないだ組織 */
export async function ssoTenant(ctx: SsoContext): Promise<TenantFixture & { domain: string }> {
  seq += 1;
  const label = `sso${seq}-${uuidv7().slice(-6)}`;
  const f = await createTenantFixture(ctx.owner, label);
  const domain = `${label}.test`;
  await enterprise(ctx, f.tenantId);
  await withTenant(ctx.owner, f.tenantId, (tx) =>
    tx.insert(domains).values({
      id: uuidv7(),
      tenantId: f.tenantId,
      domain,
      verifyToken: "t",
      verifiedAt: new Date(),
      createdBy: f.users.admin.id,
    }),
  );
  const r = await connectSso(ctx.owner, ctx.cognito, {
    tenantId: f.tenantId,
    metadataUrl: METADATA,
    execute: true,
  });
  expect(r.mode).toBe("connected");
  return { ...f, domain };
}

export async function startSso(ctx: SsoContext, email: string) {
  const res = await call(ctx.t.app, "POST", "/api/auth/sso/start", { body: { email } });
  expect(res.status).toBe(200);
  return { body: (await res.json()) as SsoStartResult, cookie: cookieOf(res, "sso") };
}

/** IdP へ回り、IdP がこのメールの人を返したことにして戻る。戻り先(Location)と Cookie を返す */
export async function ssoLogin(ctx: SsoContext, email: string, asserted = email) {
  const { body, cookie } = await startSso(ctx, email);
  if (body.next !== "redirect") throw new Error("SSO のドメインのはず");
  const code = ctx.t.fake.issueSsoCode(body.url, asserted);
  const state = new URL(body.url).searchParams.get("state") ?? "";
  const res = await call(
    ctx.t.app,
    "GET",
    `/api/auth/sso/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    { cookie },
  );
  expect(res.status).toBe(302);
  return { location: res.headers.get("location"), sid: cookieOf(res, "sid") };
}

export const codeOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;

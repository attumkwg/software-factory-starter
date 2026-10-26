import { SsoStartResultSchema, SsoStartSchema } from "@app/shared";
import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { withTenant } from "../db/tenant.ts";
import { findSsoMember, findSsoProviderByDomain } from "../domains/organizations/index.ts";
import type { AppEnv } from "../env.ts";
import { ApiError } from "../errors.ts";
import { isFeatureEnabled } from "../feature-flags/index.ts";
import { bodyErrors, type createRouter, json, jsonBody } from "../http/common.ts";
import { finishLogin, type LoginDeps } from "./login.ts";
import { startPendingSso, takePendingSso } from "./pending-sso.ts";
import type { CognitoClient } from "./providers.ts";

// SSO(SAML)のログインの入口(docs/specs/0056-sso-scim-ip-audit-export.md・設計書 0056 の 0・3・6・ADR 0067)。
//   開始 … メールのドメインが、確かめたドメインに IdP をつないだ組織なら、Cognito の /oauth2/authorize(IdP を名指し)へ
//   戻り … Cognito とコードを交換し(PKCE)、ID トークンの IdP の名前で組織を決め、その組織の確かめたドメインの人で、
//          その組織に行がある人だけを入れる。初めてのログインで人を作らない(U-2)
// SAML の署名・主張の確かめは Cognito に任せ、ここでは書かない。

type Router = ReturnType<typeof createRouter>;

const startRoute = createRoute({
  method: "post",
  path: "/auth/sso/start",
  tags: ["auth"],
  summary: "会社のアカウント(SSO)でログインを始める(SSO のドメインなら IdP へ回る URL)",
  description:
    "そのドメインが SSO かどうかだけを答える(人がいるかは言わない)。SSO でなければ next: password",
  request: { body: jsonBody(SsoStartSchema) },
  responses: { 200: json(SsoStartResultSchema, "次にすること"), ...bodyErrors },
});

const CallbackQuery = z.object({
  code: z.string().max(2048).optional(),
  state: z.string().max(256).optional(),
  error: z.string().max(256).optional(),
});

const callbackRoute = createRoute({
  method: "get",
  path: "/auth/sso/callback",
  tags: ["auth"],
  summary: "IdP から戻ってくる所(Cognito のコールバック)。入れたら画面へ、だめならログインの画面へ",
  request: { query: CallbackQuery },
  responses: {
    302: {
      description: "画面へ(Cookie を出した)か、ログインの画面へ(?sso=failed など。理由は言わない)",
    },
  },
});

/** ログインの画面に返す理由(画面の messages.ts が文にする)。どこが違ったかは言わない */
type Failure = "failed" | "ip_not_allowed";

export function addSsoRoutes(router: Router, deps: LoginDeps, idp: CognitoClient) {
  router
    .openapi(startRoute, async (c) => {
      // OAuth の入口が無い環境では、いつも「パスワードへ」
      if (!idp.ssoEnabled) return c.json({ next: "password" as const }, 200);
      const domain = c.req.valid("json").email.split("@")[1]?.toLowerCase() ?? "";
      const provider = await findSsoProviderByDomain(deps.db, domain);
      if (!provider) return c.json({ next: "password" as const }, 200);
      const { state, codeChallenge } = await startPendingSso(c, deps.session, provider);
      const url = idp.authorizeUrl({ providerName: provider, state, codeChallenge });
      return c.json({ next: "redirect" as const, url }, 200);
    })
    .openapi(callbackRoute, async (c) => {
      const failure = idp.ssoEnabled
        ? await finishSso(deps, idp, c, c.req.valid("query"))
        : "failed";
      const to = failure ? `/login?sso=${failure}` : "/";
      return c.redirect(`${idp.appUrl}${to}`, 302);
    });
}

/** 戻りを確かめて入れる。だめなら理由を返す(理由の詳しいことはログにだけ。メールは出さない) */
async function finishSso(
  deps: LoginDeps,
  idp: CognitoClient,
  c: Context<AppEnv>,
  q: z.infer<typeof CallbackQuery>,
): Promise<Failure | null> {
  const refuse = (reason: string): Failure => {
    deps.logger.warn({ reason }, "SSO のログインを断りました");
    return "failed";
  };
  // IdP か Cognito が断った(利用者が取り消した・IdP の設定の誤り)
  if (q.error) return refuse(`idp_error:${q.error.slice(0, 64)}`);
  const pending = q.state ? await takePendingSso(c, deps.session, q.state) : null;
  if (!pending || !q.code) return refuse("state_mismatch");
  const identity = await idp.exchangeSsoCode(q.code, pending.verifier);
  if (!identity) return refuse("code_rejected");
  // 回した IdP と違う IdP から戻ってきた(別のタブで始めたログインの混線も含む)
  if (identity.providerName !== pending.provider) return refuse("provider_mismatch");
  const member = await findSsoMember(deps.db, identity.providerName, identity.email);
  if (!member) return refuse("no_member");
  const defs = { featureFlags: c.get("featureFlags"), plans: c.get("plans") };
  const enabled = await withTenant(deps.db, member.tenantId, (tx) =>
    isFeatureEnabled(tx, member.tenantId, defs.featureFlags, "sso", defs.plans),
  );
  if (!enabled) return refuse("feature_off");
  try {
    await finishLogin(deps, c, member, { via: "sso" });
    return null;
  } catch (e) {
    if (e instanceof ApiError && e.code === "ip_not_allowed") return "ip_not_allowed";
    throw e;
  }
}

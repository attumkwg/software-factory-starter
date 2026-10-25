import {
  currentPreRegistrationConsent,
  LpViewRequestSchema,
  PreRegistrationLinkSchema,
  PreRegistrationRequestSchema,
} from "@app/shared";
import { createRoute } from "@hono/zod-openapi";
import type { RootDb } from "../db/client.ts";
import { withTenant } from "../db/tenant.ts";
import {
  confirmPreRegistration,
  countView,
  type PublicScope,
  registerPreRegistration,
  withdrawPreRegistration,
} from "../domains/growth/index.ts";
import { badRequest, notFound } from "../errors.ts";
import { bodyErrors, createRouter, jsonBody, notFoundError } from "../http/common.ts";

// 公開の LP(apps/site)から呼ばれる入口(docs/specs/0025-public-landing-page.md・設計書 0025 の 3)。
// 権限は policy.ts の public(ログインを見ない)。テナントはリクエストから決めず、設定の運営の組織に固定する。
// 公開のページの URL と運営の組織が設定に無ければ、全部 404(公開の入口ごと使わない)。
// CORS(公開のページの origin だけ・資格情報なし)は app.ts が /api/public/* に付ける。
// 運営の組織の文脈(withTenant)をここで開くので、領域(domains/growth)の外に置く(Semgrep の tenant-scoped-db-only)。
// 読み書きの中身は領域の index.ts の関数。

export type PublicGrowthDeps = {
  db: RootDb;
  /** 運営の組織(SUPPORT_TENANT_ID)と、リンクの鍵。どちらかが無ければ null */
  site: { tenantId: string; key: Buffer } | null;
};

// 404 は公開の入口を使っていないとき(設定に公開のページか運営の組織が無い)
const publicErrors = { ...bodyErrors, ...notFoundError } as const;

export function publicGrowthRoutes(deps: PublicGrowthDeps) {
  const inOperatorTenant = <T>(fn: (scope: PublicScope) => Promise<T>) => {
    const site = deps.site;
    if (!site) throw notFound();
    return withTenant(deps.db, site.tenantId, (tx) => fn({ tx, tenantId: site.tenantId }));
  };
  const keyOf = () => {
    if (!deps.site) throw notFound();
    return deps.site.key;
  };

  return createRouter()
    .openapi(
      createRoute({
        method: "post",
        path: "/public/pre-registrations",
        tags: ["public"],
        summary:
          "事前登録を受ける(同意のチェックが要る)。確認のメールを積む。登録の有無に関わらず同じ答え",
        request: { body: jsonBody(PreRegistrationRequestSchema) },
        responses: { 204: { description: "受け付けた" }, ...publicErrors },
      }),
      async (c) => {
        const input = c.req.valid("json");
        // 罠の欄に値がある = 機械。何もせずに同じ答え
        if (input.website) return c.body(null, 204);
        if (input.consentTextVersion !== currentPreRegistrationConsent().version) {
          throw badRequest("同意の文が新しくなりました。ページを読み込み直してください");
        }
        await inOperatorTenant((scope) => registerPreRegistration(scope, input));
        return c.body(null, 204);
      },
    )
    .openapi(
      createRoute({
        method: "post",
        path: "/public/pre-registrations/confirm",
        tags: ["public"],
        summary: "確認のリンクを開いた(公開のページの /confirm が # の後ろの token を送る)",
        request: { body: jsonBody(PreRegistrationLinkSchema) },
        responses: { 204: { description: "確かめた" }, ...publicErrors },
      }),
      async (c) => {
        const { token } = c.req.valid("json");
        const key = keyOf();
        const ok = await inOperatorTenant((scope) => confirmPreRegistration(scope, key, token));
        if (!ok) throw badRequest("リンクの期限が切れたか、使えないリンクです");
        return c.body(null, 204);
      },
    )
    .openapi(
      createRoute({
        method: "post",
        path: "/public/pre-registrations/withdraw",
        tags: ["public"],
        summary: "取り消しのリンク(登録を消す)。無い登録でも同じ答え",
        request: { body: jsonBody(PreRegistrationLinkSchema) },
        responses: { 204: { description: "消した(か、もう無い)" }, ...publicErrors },
      }),
      async (c) => {
        const { token } = c.req.valid("json");
        const key = keyOf();
        await inOperatorTenant((scope) => withdrawPreRegistration(scope, key, token));
        return c.body(null, 204);
      },
    )
    .openapi(
      createRoute({
        method: "post",
        path: "/public/lp-views",
        tags: ["public"],
        summary: "公開のページが開かれた(日ごと・ページ・来た所ごとの数に1足す。Cookie を使わない)",
        request: { body: jsonBody(LpViewRequestSchema) },
        responses: { 204: { description: "数えた" }, ...publicErrors },
      }),
      async (c) => {
        await inOperatorTenant((scope) => countView(scope, c.req.valid("json")));
        return c.body(null, 204);
      },
    );
}

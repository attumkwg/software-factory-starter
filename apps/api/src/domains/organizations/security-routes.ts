import {
  CreateDomainSchema,
  IdSchema,
  IpAllowlistSchema,
  OrganizationDomainListSchema,
  OrganizationDomainSchema,
  OrganizationMemberPageSchema,
  PutIpAllowlistSchema,
} from "@app/shared";
import { createRoute, z } from "@hono/zod-openapi";
import type { RootDb } from "../../db/client.ts";
import { scopeOf } from "../../db/scope.ts";
import { withTenant } from "../../db/tenant.ts";
import { ApiError, notFound } from "../../errors.ts";
import { isFeatureEnabled, requireFeature } from "../../feature-flags/index.ts";
import { clientIp } from "../../http/client-ip.ts";
import {
  authErrors,
  badRequestError,
  bodyErrors,
  conflictError,
  createRouter,
  json,
  jsonBody,
  notFoundError,
  PageQuery,
} from "../../http/common.ts";
import {
  createDomain,
  deleteDomain,
  findDomain,
  findIpAllowlist,
  hasVerifyRecord,
  listDomains,
  listMembers,
  markDomainVerified,
  replaceIpAllowlist,
  signOutMember,
} from "./security.ts";

// 大きなお客さん向けの守りの段1a(管理者。docs/specs/0056-sso-scim-ip-audit-export.md):
// 会社のドメインの確認・組織に入れる IP の範囲・人の一覧と強制ログアウト。
// ドメインと IP の範囲はプランの機能(sso・ip-allowlist。入っていなければ 404。設計書 0056 の U-6)。
// 権限はここに書かない(src/authz/policy.ts の ROUTE_RULES と docs/authz/matrix.yaml)。

const tags = ["organization"];
const DomainParams = z.object({ domainId: IdSchema });
const MemberParams = z.object({ memberId: IdSchema });

/** DNS の TXT を引く(テストは差し替える)。見つからない・引けないときは空 */
export type ResolveTxt = (name: string) => Promise<string[][]>;

/** 会社のドメイン(プランの機能 sso) */
export function domainRoutes(deps: { db: RootDb; resolveTxt: ResolveTxt }) {
  return createRouter()
    .openapi(
      createRoute({
        method: "get",
        path: "/organization/domains",
        tags,
        summary: "【管理者】会社のドメインと、DNS に置く確かめのレコード",
        responses: { 200: json(OrganizationDomainListSchema, "一覧"), ...authErrors },
      }),
      async (c) => {
        await requireFeature(c, "sso");
        return c.json({ domains: await listDomains(scopeOf(c)) }, 200);
      },
    )
    .openapi(
      createRoute({
        method: "post",
        path: "/organization/domains",
        tags,
        summary: "【管理者】会社のドメインを登録する(DNS で確かめるまで使えない)",
        request: { body: jsonBody(CreateDomainSchema) },
        responses: {
          201: json(OrganizationDomainSchema, "登録した"),
          ...bodyErrors,
          ...authErrors,
          ...conflictError,
        },
      }),
      async (c) => {
        await requireFeature(c, "sso");
        return c.json(await createDomain(scopeOf(c), c.req.valid("json").domain), 201);
      },
    )
    .openapi(
      createRoute({
        method: "post",
        path: "/organization/domains/{domainId}/verify",
        tags,
        summary:
          "【管理者】DNS の TXT を見て、ドメインを確かめる(外を待つので、トランザクションの外)",
        request: { params: DomainParams },
        responses: {
          200: json(OrganizationDomainSchema, "確かめた"),
          ...badRequestError,
          ...authErrors,
          ...notFoundError,
          ...conflictError,
        },
      }),
      async (c) => {
        const { tenantId } = c.get("actor");
        const { domainId } = c.req.valid("param");
        const domain = await withTenant(deps.db, tenantId, async (tx) => {
          const enabled = await isFeatureEnabled(
            tx,
            tenantId,
            c.get("featureFlags"),
            "sso",
            c.get("plans"),
          );
          return enabled ? findDomain(tx, tenantId, domainId) : null;
        });
        if (!domain) throw notFound();
        // DNS はトランザクションの外で待つ(apps/api/CLAUDE.md の DB の時間切れ)
        const records = await deps.resolveTxt(domain.verifyRecord.name).catch(() => []);
        if (!hasVerifyRecord(records, domain)) {
          throw new ApiError(409, "domain_not_verified", "DNS にまだ確かめの文字が見えません");
        }
        const verified = await withTenant(deps.db, tenantId, (tx) =>
          markDomainVerified(tx, tenantId, domainId),
        );
        return c.json(verified, 200);
      },
    )
    .openapi(
      createRoute({
        method: "delete",
        path: "/organization/domains/{domainId}",
        tags,
        summary: "【管理者】会社のドメインを消す",
        request: { params: DomainParams },
        responses: {
          204: { description: "消した" },
          ...badRequestError,
          ...authErrors,
          ...notFoundError,
        },
      }),
      async (c) => {
        await requireFeature(c, "sso");
        if (!(await deleteDomain(scopeOf(c), c.req.valid("param").domainId))) throw notFound();
        return c.body(null, 204);
      },
    );
}

/** 組織に入れる IP の範囲(プランの機能 ip-allowlist) */
export const ipAllowlistRoutes = createRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/organization/ip-allowlist",
      tags,
      summary: "【管理者】組織に入れる IP の範囲(空なら制限しない)と、いまの IP",
      responses: { 200: json(IpAllowlistSchema, "一覧"), ...authErrors },
    }),
    async (c) => {
      await requireFeature(c, "ip-allowlist");
      const { tenantId } = c.get("actor");
      const cidrs = await findIpAllowlist(c.get("tx"), tenantId);
      return c.json({ cidrs, yourIp: clientIp(c) }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/organization/ip-allowlist",
      tags,
      summary:
        "【管理者】組織に入れる IP の範囲を入れ替える(20 まで。いまの IP を含まなければ 409)",
      request: { body: jsonBody(PutIpAllowlistSchema) },
      responses: {
        200: json(IpAllowlistSchema, "入れ替えた"),
        ...bodyErrors,
        ...authErrors,
        ...conflictError,
      },
    }),
    async (c) => {
      await requireFeature(c, "ip-allowlist");
      const yourIp = clientIp(c);
      const cidrs = await replaceIpAllowlist(scopeOf(c), c.req.valid("json").cidrs, yourIp);
      return c.json({ cidrs, yourIp }, 200);
    },
  );

/** 組織の人の一覧と強制ログアウト(全部の組織) */
export const memberRoutes = createRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/organization/members",
      tags,
      summary: "【管理者】組織の人(古い順に1ページずつ)",
      request: { query: PageQuery },
      responses: {
        200: json(OrganizationMemberPageSchema, "一覧"),
        ...badRequestError,
        ...authErrors,
      },
    }),
    async (c) => c.json(await listMembers(scopeOf(c), c.req.valid("query")), 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/organization/members/{memberId}/sign-out",
      tags,
      summary:
        "【管理者】その人を強制ログアウトする(この組織の全部の端末が、次のリクエストから入れない)",
      request: { params: MemberParams },
      responses: {
        204: { description: "切った" },
        ...badRequestError,
        ...authErrors,
        ...notFoundError,
      },
    }),
    async (c) => {
      if (!(await signOutMember(scopeOf(c), c.req.valid("param").memberId))) throw notFound();
      return c.body(null, 204);
    },
  );

/** 段1a のルートをまとめて(app.ts は1行で足す) */
export function securityRoutes(deps: { db: RootDb; resolveTxt: ResolveTxt }) {
  return createRouter()
    .route("/", domainRoutes(deps))
    .route("/", ipAllowlistRoutes)
    .route("/", memberRoutes);
}

import {
  CreateDomainSchema,
  IdSchema,
  IpAllowlistSchema,
  OrganizationDomainListSchema,
  OrganizationDomainSchema,
  OrganizationMemberPageSchema,
  PutIpAllowlistSchema,
  PutSsoSettingsSchema,
  SsoSettingsSchema,
} from "@app/shared";
import { createRoute, z } from "@hono/zod-openapi";
import { scopeOf } from "../../db/scope.ts";
import { notFound } from "../../errors.ts";
import { requireFeature } from "../../feature-flags/index.ts";
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
  findIpAllowlist,
  listDomains,
  listMembers,
  replaceIpAllowlist,
  signOutMember,
} from "./security.ts";
import { getSsoSettings, updateSsoSettings } from "./sso.ts";

// 大きなお客さん向けの守りの段1a・1b(管理者。docs/specs/0056-sso-scim-ip-audit-export.md):
// 会社のドメインの確認・SSO の必須と緊急用・組織に入れる IP の範囲・人の一覧と強制ログアウト。
// ドメインと IP の範囲はプランの機能(sso・ip-allowlist。入っていなければ 404。設計書 0056 の U-6)。
// 権限はここに書かない(src/authz/policy.ts の ROUTE_RULES と docs/authz/matrix.yaml)。

const tags = ["organization"];
const DomainParams = z.object({ domainId: IdSchema });
const MemberParams = z.object({ memberId: IdSchema });

/**
 * 会社のドメイン(プランの機能 sso)。DNS で確かめる API は外を待つので、関所のトランザクションの外で
 * 自分の短いトランザクションを開く(src/auth/domain-verify-routes.ts。領域の中では接続プールを使わない)
 */
const domainRoutes = createRouter()
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

/** SSO の必須と緊急用(段1b・プランの機能 sso)。IdP をつなぐ・外すのは運営のコマンド(設計書 0056 の U-1) */
const ssoRoutes = createRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/organization/sso",
      tags,
      summary: "【管理者】SSO の設定(IdP がつながっているか・必須か・緊急用のアカウント)",
      responses: { 200: json(SsoSettingsSchema, "設定"), ...authErrors },
    }),
    async (c) => {
      await requireFeature(c, "sso");
      return c.json(await getSsoSettings(scopeOf(c)), 200);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/organization/sso",
      tags,
      summary:
        "【管理者】SSO の必須と緊急用のアカウント(管理者だけ・2人まで)を入れ替える。必須には IdP と緊急用が1人以上要る(409)",
      request: { body: jsonBody(PutSsoSettingsSchema) },
      responses: {
        200: json(SsoSettingsSchema, "入れ替えた"),
        ...bodyErrors,
        ...authErrors,
        ...conflictError,
      },
    }),
    async (c) => {
      await requireFeature(c, "sso");
      return c.json(await updateSsoSettings(scopeOf(c), c.req.valid("json")), 200);
    },
  );

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

/** 段1a・1b のルートをまとめて(app.ts は1行で足す。DNS で確かめる API だけは src/auth/domain-verify-routes.ts) */
export const securityRoutes = createRouter()
  .route("/", domainRoutes)
  .route("/", ssoRoutes)
  .route("/", ipAllowlistRoutes)
  .route("/", memberRoutes);

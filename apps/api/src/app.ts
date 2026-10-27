import { resolveTxt } from "node:dns/promises";
import {
  FEATURE_FLAGS,
  type FeatureFlagDefinition,
  LEGAL_VERSIONS,
  type LegalVersion,
  PLANS,
  type PlanDefinition,
  SCIM_BASE_PATH,
} from "@app/shared";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";
import { routePath } from "hono/route";
import { secureHeaders } from "hono/secure-headers";
import { auditRoutes } from "./audit/index.ts";
import { accountRoutes } from "./auth/account-routes.ts";
// 大きなお客さん向けの守りの段1a(ドメイン・IP の範囲・強制ログアウト。docs/specs/0056-sso-scim-ip-audit-export.md)
import { organizationSecurityRoutes, type ResolveTxt } from "./auth/domain-verify-routes.ts";
import { invitationAcceptRoutes } from "./auth/invitation-routes.ts";
import { authenticate } from "./auth/middleware.ts";
import { organizationSwitchRoutes } from "./auth/organization-routes.ts";
import { CognitoClient } from "./auth/providers.ts";
import { authRoutes } from "./auth/routes.ts";
// 情シスの道具の入口(SCIM 2.0。段2。セッションではなく SCIM の鍵で組織が決まる)
import { scimErrorBody, scimRoutes } from "./auth/scim-routes.ts";
import { supportSessionRoutes } from "./auth/support-routes.ts";
import { authorize } from "./authz/middleware.ts";
import type { Config } from "./config.ts";
import type { RootDb } from "./db/client.ts";
import { withTenant } from "./db/tenant.ts";
import { fileRoutes, type InTenantTx } from "./domains/files/index.ts";
import { linkKey } from "./domains/growth/index.ts";
import { legalRoutes } from "./domains/legal/index.ts";
import {
  invitationRoutes,
  mfaRequirementRoutes,
  organizationRoutes,
  supportGrantRoutes,
} from "./domains/organizations/index.ts";
import { projectRoutes } from "./domains/projects/index.ts";
import { taskRoutes } from "./domains/tasks/index.ts";
import type { AppEnv } from "./env.ts";
import { payloadTooLarge, toApiError } from "./errors.ts";
import { auditExportRoutes } from "./export/audit-routes.ts";
import { exportRoutes } from "./export/routes.ts";
import { healthRoutes, type Lifecycle } from "./health.ts";
import type { Logger } from "./logger.ts";
import { planRoutes } from "./plans/index.ts";
import { pmfSurveyRoutes } from "./pmf-survey/index.ts";
import { publicGrowthRoutes } from "./pre-registrations/index.ts";
import { contextFromHeaders, getRequestContext, runWithRequestContext } from "./request-context.ts";
import type { SensitiveStore } from "./sensitive/index.ts";
import type { ObjectStore } from "./storage/index.ts";

export type AppDeps = {
  config: Config;
  db: RootDb;
  logger: Logger;
  lifecycle?: Lifecycle;
  /** テスト用: 偽物の Cognito につないだ物に差し替える */
  cognito?: CognitoClient;
  /** テスト用: 規約の版の一覧を差し替える(「効力の日が来た」「予告中」を作る)。既定は LEGAL_VERSIONS */
  legalVersions?: readonly LegalVersion[];
  /** テスト用: 機能フラグの定義を差し替える(キットには1つも無いので)。既定は FEATURE_FLAGS */
  featureFlags?: readonly FeatureFlagDefinition[];
  /** テスト用: DNS の TXT を引く関数(ドメインの確認。docs/specs/0056-sso-scim-ip-audit-export.md)。既定は node:dns */
  resolveTxt?: ResolveTxt;
  /** テスト用: プランの定義を差し替える(機能つきのプランを作る)。既定は PLANS */
  plans?: readonly PlanDefinition[];
  /** 要配慮個人情報の入口(ADR 0029。index.ts が設定から作る)。無ければ null(段0) */
  sensitive?: SensitiveStore | null;
  /** 写真・ファイルの置き場(docs/designs/0072-file-storage.md。index.ts が設定から作る)。無ければ null(ファイルの API は 503) */
  files?: ObjectStore | null;
};

/**
 * どの API か(メソッド+ID を入れる前の道すじ。例 "POST /api/projects/:projectId/tasks")。
 * path と違って値(ID)が入らないので、Sentry にも送れる・Logs Insights で API ごとに数えられる。
 */
function routeOf(c: Context): string {
  return `${c.req.method} ${routePath(c, -1)}`;
}

/** 1リクエストの文脈(request ID・trace ID)を作り、終わったらアクセスログを1行。 */
function requestContext(logger: Logger): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const ctx = contextFromHeaders((name) => c.req.header(name));
    const started = performance.now();
    await runWithRequestContext(ctx, async () => {
      c.header("x-request-id", ctx.requestId);
      await next();
      const isHealth = c.req.path === "/healthz" || c.req.path === "/readyz";
      logger[isHealth ? "debug" : "info"](
        {
          method: c.req.method,
          path: c.req.path,
          route: routeOf(c),
          status: c.res.status,
          durationMs: Math.round(performance.now() - started),
        },
        "request",
      );
    });
  };
}

/**
 * 公開の LP(apps/site。別の origin)から呼ばれる入口(/api/public/*)だけに付ける守り。
 * CORS はその origin にだけ開く(資格情報なし・Cookie を送らせない)。下見(OPTIONS)はここで答える(関所まで行かない)。
 * 公開の LP の URL が無ければ、どの origin にも開かない。本文は 8KB まで。
 */
function publicEntranceGuards(config: Config): MiddlewareHandler<AppEnv>[] {
  const publicSiteOrigin = config.publicSite?.origin ?? null;
  return [
    cors({
      origin: (origin) => (publicSiteOrigin && origin === publicSiteOrigin ? origin : null),
      allowMethods: ["POST"],
      allowHeaders: ["content-type"],
      credentials: false,
      maxAge: 600,
    }),
    bodyLimit({
      maxSize: 8 * 1024,
      onError: () => {
        throw payloadTooLarge();
      },
    }),
  ];
}

/** 公開の入口が使う運営の組織とリンクの鍵。公開の LP の URL か運営の組織が無ければ null(公開の入口は全部 404) */
function publicGrowthSite(config: Config) {
  return config.publicSite && config.supportTenantId
    ? { tenantId: config.supportTenantId, key: linkKey(config.session.secret) }
    : null;
}

/**
 * 関所とハンドラーが読む設定を、リクエストの文脈(c.var)に置く。
 * 運営の組織(社員の代理ログイン。ハンドラーと /api/me が「社員か」を判断する)・二段階認証の必須を効かせるか
 * (関所と /api/me)・いまの人の IP を読むヘッダー(組織ごとの IP の制限)・規約の版の一覧(関所と同意の API)・
 * 機能フラグとプランの定義(/api/me と requireFeature)・要配慮個人情報の入口(sensitiveOf(c))
 */
function appContext(deps: AppDeps): MiddlewareHandler<AppEnv> {
  const { config } = deps;
  const legalVersions = deps.legalVersions ?? LEGAL_VERSIONS;
  const featureFlags = deps.featureFlags ?? FEATURE_FLAGS;
  const plans = deps.plans ?? PLANS;
  return async (c, next) => {
    c.set("supportTenantId", config.supportTenantId);
    c.set("mfaEnforced", config.auth.mode === "cognito");
    c.set("clientIpSource", config.clientIp);
    c.set("legalVersions", legalVersions);
    c.set("featureFlags", featureFlags);
    c.set("plans", plans);
    c.set("sensitive", deps.sensitive ?? null);
    await next();
  };
}

export function createApp(deps: AppDeps) {
  const { config, db, logger } = deps;
  const lifecycle = deps.lifecycle ?? { shuttingDown: false };
  const app = new OpenAPIHono<AppEnv>();

  app.use("*", requestContext(logger));
  // JSON を gzip で縮める(ALB は縮めない)。縮めてよい種類(JSON・文字)だけで、SSE(text/event-stream)・
  // 縮め済み・Cache-Control: no-transform の応答には触らない(hono/compress の決まり)
  app.use("*", compress());
  app.use("*", secureHeaders());
  app.route("/", healthRoutes({ db, lifecycle, logger }));

  // ここから下の /api/* は、全部「本文の大きさ → セッションを読む → 認可の関所」を通る
  // API の応答はログインした人ごとの中身なので、ブラウザ・途中の経路に残させない。
  // 自分で Cache-Control を決めた API(あれば)はそのまま。失敗の応答(onError)にも付く
  app.use("/api/*", async (c, next) => {
    await next();
    if (!c.res.headers.has("cache-control")) c.res.headers.set("cache-control", "no-store");
  });
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: () => {
        throw payloadTooLarge();
      },
    }),
  );
  app.use("/api/public/*", ...publicEntranceGuards(config));
  // SCIM の入口(情シスの道具)は Cookie を使わず鍵だけで決まるので、よそのサイトのフォームの心配が無い。
  // 道具は Origin を付けず、本文の無い DELETE も送る(Hono の csrf は種類の無い本文をフォームとみなして断る)
  const csrfGuard = csrf();
  app.use("/api/*", (c, next) =>
    c.req.path.startsWith(`${SCIM_BASE_PATH}/`) ? next() : csrfGuard(c, next),
  );
  app.use("/api/*", authenticate(config.session));
  app.use("/api/*", appContext(deps));
  app.use("/api/*", authorize({ db, logger, session: config.session }));

  // Cognito のときだけ(開発用ログインには Cognito が無い)。ログインと本人のアカウントで同じつなぎ方を使う
  const cognito =
    config.auth.mode === "cognito" ? (deps.cognito ?? new CognitoClient(config.auth)) : undefined;
  app.route(
    "/api",
    authRoutes({ db, logger, session: config.session, auth: { ...config.auth, cognito } }),
  );
  // 本人のアカウント(二段階認証・メール・パスワード。docs/specs/0006-account-security.md)
  if (cognito) app.route("/api", accountRoutes({ db, logger, session: config.session, cognito }));
  // 招待を受ける(ログインの前。リンクの札で組織が決まる。docs/specs/0027-invitations.md)
  app.route("/api", invitationAcceptRoutes({ db, logger, linkSecret: config.session.secret }));
  // 領域ごとのルート(src/domains/<領域>/routes.ts)
  app.route("/api", organizationRoutes);
  app.route("/api", mfaRequirementRoutes);
  app.route("/api", supportGrantRoutes());
  app.route("/api", invitationRoutes);
  // 社員の代理ログイン(組織を切り替えるので認証の側)
  app.route("/api", supportSessionRoutes({ db, session: config.session }));
  // 所属している組織と、組織の選び直し(組織を切り替えるので認証の側。docs/specs/0055-multi-org-membership.md)
  app.route("/api", organizationSwitchRoutes({ db, session: config.session }));
  app.route("/api", projectRoutes);
  app.route("/api", taskRoutes);
  // 関所の外で動くファイルの API が、組織の文脈つきのトランザクションを開く(組織はセッションから。ADR 0079)
  const inTenant: InTenantTx = (tenantId, fn) => withTenant(db, tenantId, fn);
  app.route("/api", fileRoutes({ inTenant, store: deps.files ?? null }));
  app.route("/api", legalRoutes);
  // 公開の LP の事前登録と見た数(docs/specs/0025-public-landing-page.md)。運営の組織の持ち物
  app.route("/api", publicGrowthRoutes({ db, site: publicGrowthSite(config) }));
  // 共通の仕組み(領域ではない)
  app.route("/api", auditRoutes);
  app.route("/api", exportRoutes({ db, logger }));
  // 監査ログの書き出し(段3。プランの機能 audit-export)
  app.route("/api", auditExportRoutes({ db, logger }));
  app.route("/api", planRoutes);
  app.route("/api", organizationSecurityRoutes({ db, resolveTxt: deps.resolveTxt ?? resolveTxt }));
  app.route("/api", scimRoutes({ db }));
  app.route("/api", pmfSurveyRoutes);

  if (config.exposeOpenApi) {
    app.doc31("/api/openapi.json", {
      openapi: "3.1.0",
      info: { title: "software-factory-starter API", version: "0.1.0" },
    });
  }

  // 画面は配らない。画面は別のサービス(apps/web の SSR)で、ALB が /api/* だけをここへ振り分ける。

  app.notFound((c) =>
    c.json(
      {
        error: {
          code: "not_found",
          message: "見つかりません",
          requestId: getRequestContext()?.requestId,
        },
      },
      404,
    ),
  );

  // 失敗はすべてここで同じ形にする(errors.ts)。中身(SQL・値・スタック)は返さない。
  //   4xx … 利用者の側の問題。ログは残さない(アクセスログに status が出る)
  //   409 … 同時の変更。多いと設計の問題なので warn で数える
  //   5xx … こちらの問題。error で残す(503 は待てば通るので Retry-After を付ける)
  app.onError((err, c) => {
    const requestId = getRequestContext()?.requestId;
    const apiError = toApiError(err);
    const route = routeOf(c);
    if (apiError.status >= 500) logger.error({ err, code: apiError.code, route }, "失敗しました");
    else if (apiError.code === "conflict")
      logger.warn({ err, route }, "同時の変更とぶつかりました");
    if (apiError.code === "service_unavailable") c.header("retry-after", "5");
    // 情シスの道具には SCIM の Error の形で(RFC 7644 の 3.12)
    if (c.req.path.startsWith(`${SCIM_BASE_PATH}/`)) {
      c.header("content-type", "application/scim+json");
      return c.body(JSON.stringify(scimErrorBody(apiError)), apiError.status);
    }
    return c.json(
      { error: { code: apiError.code, message: apiError.message, requestId } },
      apiError.status,
    );
  });

  return app;
}

export type App = ReturnType<typeof createApp>;

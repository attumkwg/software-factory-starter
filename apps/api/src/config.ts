import { logsLinkFrom } from "@app/error-reporting";
import { z } from "zod";
import { FILES_ENV_SHAPE, filesConfig, filesIssues } from "./config-files.ts";

export { loadFilesConfig } from "./config-files.ts";

// 環境の名前。開発用ログインを使ってよいのは local / test / preview だけ(本物の利用者がいない所)。
export const APP_ENVS = ["local", "test", "preview", "stg", "prod"] as const;
const DEV_LOGIN_ALLOWED: ReadonlySet<string> = new Set(["local", "test", "preview"]);
// 偽物の Cognito・http の URL を使ってよい所(手元とテスト)
const LOCAL_ONLY: ReadonlySet<string> = new Set(["local", "test"]);
// 手元の画面(docker compose の ALB の代わり)。stg・prod では APP_URL が必須
const DEFAULT_APP_URL = "http://localhost:8080";

const EnvObject = z.object({
  APP_ENV: z.enum(APP_ENVS).default("local"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  // アプリの接続ユーザー(表の持ち主ではない・RLS がかかる)
  DATABASE_URL: z.string().min(1),
  // 要配慮個人情報だけの接続ユーザー(ロール app_sensitive。ADR 0029)。無ければ要配慮は扱わない(段0)
  SENSITIVE_DATABASE_URL: z.string().min(1).optional(),
  // 組織ごとのデータ鍵を包む KMS の鍵の ARN。無ければ手元の包み鍵(local / test / preview だけ)
  SENSITIVE_KMS_KEY_ID: z.string().optional(),
  AUTH_MODE: z.enum(["dev", "cognito"]).default("dev"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET は32文字以上にしてください"),
  // ログインの有効期間(ADR 0017): 無操作でこの秒数たったら切れる・使い続けてもログインからこの秒数で切れる
  SESSION_IDLE_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60),
  SESSION_MAX_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(12 * 60 * 60),
  COGNITO_REGION: z.string().optional(),
  COGNITO_USER_POOL_ID: z.string().optional(),
  COGNITO_CLIENT_ID: z.string().optional(),
  // この画面の URL(メールのリンク・ログアウトの後の行き先。Host ヘッダーは信じない)
  APP_URL: z.url().optional(),
  // Cognito の API の入口を変える。手元の偽物の Cognito(packages/fake-cognito)だけ
  COGNITO_ENDPOINT: z.url().optional(),
  // ユーザープールの OAuth の入口(https://auth.example.com。SSO でブラウザが回る先)。無ければ SSO は使わない
  // (docs/designs/0056-sso-scim-ip-audit-export.md の 5。Terraform の出力 cognito_oauth_url)
  COGNITO_OAUTH_URL: z.url().optional(),
  // API がコードを交換する先(手元の偽物だけ。ブラウザは localhost、API はコンテナの名前で届くため)
  COGNITO_OAUTH_INTERNAL_URL: z.url().optional(),
  // メールを渡す先(Postfix)。smtp://mail:25 など。無ければ送らずに記録だけ(local / test / preview だけ)
  MAIL_SMTP_URL: z.url().optional(),
  // 送り元。SES で確かめたドメインのアドレス(例: "Tasks <no-reply@example.com>")
  MAIL_FROM: z.string().min(3).default("Tasks <no-reply@example.test>"),
  // ECS の stopTimeout(既定30秒)より短く
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(25_000),
  // アウトボックスの送り出しを、この API のプロセスで回すか(ADR 0006)。別のサービスに分けたら off に
  OUTBOX_RELAY: z.enum(["on", "off"]).default("on"),
  // 公開の LP(apps/site)の URL(docs/specs/0025-public-landing-page.md)。事前登録の CORS の相手・確認のメールのリンクの頭。
  // 無ければ公開の入口(/api/public/*)は全部 404(運営の組織 SUPPORT_TENANT_ID も要る)
  PUBLIC_SITE_URL: z.url().optional(),
  // 運営の組織(社員が代理ログインに使う。docs/specs/0004-support-access.md)。無ければ代理ログインは使えない
  SUPPORT_TENANT_ID: z.uuid().optional(),
  // いまの人の IP をどのヘッダーから読むか(組織ごとの IP の制限。docs/designs/0056-sso-scim-ip-audit-export.md の 6・U-9)。
  // 既定は ALB が付ける X-Forwarded-For。CloudFront を前に置いたら CloudFront-Viewer-Address(「IP:ポート」)にできる。
  // 画面のサーバー(SSR)も同じ名前を読んで API に引き継ぐ(apps/web/src/api.ts)
  CLIENT_IP_HEADER: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,64}$/, "ヘッダーの名前の形が正しくありません")
    .default("x-forwarded-for"),
  // そのヘッダーを右から何個目まで信じるか(前にいる中継の数。ALB だけなら 1・CloudFront → ALB で X-Forwarded-For なら 2。
  // CloudFront-Viewer-Address は値が1つなので 1)
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(1).max(5).default(1),
  // 失敗を Sentry に送る先(docs/guides/monitoring.md)。無ければ送らない
  SENTRY_DSN: z.url().optional(),
  // どの版の失敗か(Sentry で「この版から増えた」が分かる)。deploy.yml がイメージの digest を入れる
  SENTRY_RELEASE: z.string().max(200).optional(),
  // Sentry の1件に「このリクエストのログを開く」リンクを付ける(Terraform が入れる)
  LOGS_INSIGHTS_REGION: z.string().optional(),
  // 探すロググループ(カンマ区切り。API と画面のサーバー)
  LOGS_INSIGHTS_GROUPS: z.string().optional(),
  // 写真・ファイルの置き場(src/config-files.ts。docs/designs/0072-file-storage.md)
  ...FILES_ENV_SHAPE,
});

type Env = z.infer<typeof EnvObject>;
type Issue = { path: keyof Env; message: string };

const EnvSchema = EnvObject.superRefine((env, ctx) => {
  for (const { path, message } of envIssues(env)) {
    ctx.addIssue({ code: "custom", path: [path], message });
  }
});

/** 環境ごとの決まりを破っている所(出す順に) */
function envIssues(env: Env): Issue[] {
  return [
    ...devLoginIssues(env),
    ...deployedIssues(env),
    ...sentryIssues(env),
    ...cognitoIssues(env),
    ...sessionIssues(env),
    ...sensitiveIssues(env),
    ...filesIssues(env),
    ...urlIssues("PUBLIC_SITE_URL", env.PUBLIC_SITE_URL, LOCAL_ONLY.has(env.APP_ENV)),
  ];
}

/** 要配慮個人情報の接続と鍵(ADR 0029) */
function sensitiveIssues(env: Env): Issue[] {
  const url = env.SENSITIVE_DATABASE_URL;
  const key = env.SENSITIVE_KMS_KEY_ID;
  if (!url) {
    return key
      ? [{ path: "SENSITIVE_KMS_KEY_ID", message: "SENSITIVE_DATABASE_URL もそろえてください" }]
      : [];
  }
  const issues: Issue[] = [];
  if (url === env.DATABASE_URL) {
    issues.push({
      path: "SENSITIVE_DATABASE_URL",
      message:
        "SENSITIVE_DATABASE_URL は DATABASE_URL と別の接続ユーザー(app_sensitive)にしてください",
    });
  }
  if (!key && !DEV_LOGIN_ALLOWED.has(env.APP_ENV)) {
    issues.push({
      path: "SENSITIVE_KMS_KEY_ID",
      message: `${env.APP_ENV} では KMS の鍵(SENSITIVE_KMS_KEY_ID)が要ります(手元の包み鍵は local / test / preview だけ)`,
    });
  }
  if (key && !key.startsWith("arn:aws:kms:")) {
    issues.push({
      path: "SENSITIVE_KMS_KEY_ID",
      message: "SENSITIVE_KMS_KEY_ID は鍵の ARN にしてください",
    });
  }
  return issues;
}

function sessionIssues(env: Env): Issue[] {
  if (env.SESSION_IDLE_SECONDS <= env.SESSION_MAX_SECONDS) return [];
  return [
    {
      path: "SESSION_IDLE_SECONDS",
      message: "SESSION_IDLE_SECONDS は SESSION_MAX_SECONDS 以下にしてください",
    },
  ];
}

function devLoginIssues(env: Env): Issue[] {
  if (env.AUTH_MODE !== "dev" || DEV_LOGIN_ALLOWED.has(env.APP_ENV)) return [];
  return [
    {
      path: "AUTH_MODE",
      message: `開発用ログインは ${env.APP_ENV} では使えません(local / test / preview だけ)`,
    },
  ];
}

/** stg・prod(本物の利用者がいる所)で要るもの */
function deployedIssues(env: Env): Issue[] {
  if (LOCAL_ONLY.has(env.APP_ENV) || env.APP_ENV === "preview") return [];
  const issues: Issue[] = [];
  if (!env.MAIL_SMTP_URL) {
    issues.push({
      path: "MAIL_SMTP_URL",
      message: `${env.APP_ENV} ではメールを送る先(MAIL_SMTP_URL)が要ります`,
    });
  }
  if (!env.APP_URL) {
    issues.push({
      path: "APP_URL",
      message: `${env.APP_ENV} では画面の URL(APP_URL。メールのリンクに使う)が要ります`,
    });
  }
  return issues;
}

function sentryIssues(env: Env): Issue[] {
  // 手元では偽物の受け口(http)を使ってよい
  if (!env.SENTRY_DSN || LOCAL_ONLY.has(env.APP_ENV) || env.SENTRY_DSN.startsWith("https://")) {
    return [];
  }
  return [{ path: "SENTRY_DSN", message: "SENTRY_DSN は https:// にしてください" }];
}

function cognitoIssues(env: Env): Issue[] {
  if (env.AUTH_MODE !== "cognito") return [];
  const issues: Issue[] = [];
  if (!(env.COGNITO_REGION && env.COGNITO_USER_POOL_ID && env.COGNITO_CLIENT_ID)) {
    issues.push({
      path: "AUTH_MODE",
      message: "cognito には COGNITO_REGION / COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID が要ります",
    });
  }
  const local = LOCAL_ONLY.has(env.APP_ENV);
  for (const key of ["COGNITO_ENDPOINT", "COGNITO_OAUTH_INTERNAL_URL"] as const) {
    if (env[key] && !local) {
      issues.push({ path: key, message: `${key}(偽物の Cognito)は local / test だけで使えます` });
    }
  }
  for (const key of [
    "COGNITO_ENDPOINT",
    "COGNITO_OAUTH_URL",
    "COGNITO_OAUTH_INTERNAL_URL",
    "APP_URL",
  ] as const) {
    issues.push(...urlIssues(key, env[key], local));
  }
  return issues;
}

/** 外から届く URL の形(本物の環境では https・最後に / を付けない) */
function urlIssues(key: Issue["path"], value: string | undefined, local: boolean): Issue[] {
  const issues: Issue[] = [];
  if (value && !local && !value.startsWith("https://")) {
    issues.push({ path: key, message: `${key} は https:// にしてください` });
  }
  if (value?.endsWith("/")) {
    issues.push({ path: key, message: `${key} の最後に / を付けないでください` });
  }
  return issues;
}

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: Record<string, string | undefined> = process.env) {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`);
    throw new Error(`設定が正しくありません:\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  return {
    appEnv: e.APP_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    sensitive: e.SENSITIVE_DATABASE_URL
      ? { databaseUrl: e.SENSITIVE_DATABASE_URL, kmsKeyArn: e.SENSITIVE_KMS_KEY_ID ?? null }
      : null,
    auth:
      e.AUTH_MODE === "cognito"
        ? {
            mode: "cognito" as const,
            region: e.COGNITO_REGION ?? "",
            userPoolId: e.COGNITO_USER_POOL_ID ?? "",
            clientId: e.COGNITO_CLIENT_ID ?? "",
            appUrl: e.APP_URL ?? DEFAULT_APP_URL,
            endpoint: e.COGNITO_ENDPOINT,
            oauthUrl: e.COGNITO_OAUTH_URL,
            oauthInternalUrl: e.COGNITO_OAUTH_INTERNAL_URL,
          }
        : { mode: "dev" as const },
    session: {
      secret: e.SESSION_SECRET,
      idleSeconds: e.SESSION_IDLE_SECONDS,
      maxSeconds: e.SESSION_MAX_SECONDS,
      // http の手元とテストだけ Secure を外す
      secureCookie: e.APP_ENV !== "local" && e.APP_ENV !== "test",
    },
    exposeOpenApi: e.APP_ENV !== "prod",
    appUrl: e.APP_URL ?? DEFAULT_APP_URL,
    mail: { smtpUrl: e.MAIL_SMTP_URL ?? null, from: e.MAIL_FROM },
    shutdownTimeoutMs: e.SHUTDOWN_TIMEOUT_MS,
    outboxRelay: e.OUTBOX_RELAY === "on",
    supportTenantId: e.SUPPORT_TENANT_ID ?? null,
    clientIp: { header: e.CLIENT_IP_HEADER.toLowerCase(), hops: e.TRUSTED_PROXY_HOPS },
    publicSite: e.PUBLIC_SITE_URL
      ? { url: e.PUBLIC_SITE_URL, origin: new URL(e.PUBLIC_SITE_URL).origin }
      : null,
    files: filesConfig(e),
    sentry: {
      dsn: e.SENTRY_DSN,
      release: e.SENTRY_RELEASE,
      logsLink: logsLinkFrom(e.LOGS_INSIGHTS_REGION, e.LOGS_INSIGHTS_GROUPS),
    },
  };
}

import { logsLinkFrom } from "@app/error-reporting";
import { z } from "zod";

// 環境の名前。開発用ログインを使ってよいのは local / test / preview だけ(本物の利用者がいない所)。
export const APP_ENVS = ["local", "test", "preview", "stg", "prod"] as const;
const DEV_LOGIN_ALLOWED: ReadonlySet<string> = new Set(["local", "test", "preview"]);
// 偽物の Cognito・http の URL を使ってよい所(手元とテスト)
const LOCAL_ONLY: ReadonlySet<string> = new Set(["local", "test"]);
// 手元の画面(docker compose の ALB の代わり)。stg・prod では APP_URL が必須
const DEFAULT_APP_URL = "http://localhost:8080";

const EnvSchema = z
  .object({
    APP_ENV: z.enum(APP_ENVS).default("local"),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    // アプリの接続ユーザー(表の持ち主ではない・RLS がかかる)
    DATABASE_URL: z.string().min(1),
    AUTH_MODE: z.enum(["dev", "cognito"]).default("dev"),
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET は32文字以上にしてください"),
    SESSION_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(8 * 60 * 60),
    COGNITO_REGION: z.string().optional(),
    COGNITO_USER_POOL_ID: z.string().optional(),
    COGNITO_CLIENT_ID: z.string().optional(),
    // この画面の URL(メールのリンク・ログアウトの後の行き先。Host ヘッダーは信じない)
    APP_URL: z.url().optional(),
    // Cognito の API の入口を変える。手元の偽物の Cognito(packages/fake-cognito)だけ
    COGNITO_ENDPOINT: z.url().optional(),
    // メールを渡す先(Postfix)。smtp://mail:25 など。無ければ送らずに記録だけ(local / test / preview だけ)
    MAIL_SMTP_URL: z.url().optional(),
    // 送り元。SES で確かめたドメインのアドレス(例: "Tasks <no-reply@example.com>")
    MAIL_FROM: z.string().min(3).default("Tasks <no-reply@example.test>"),
    // ECS の stopTimeout(既定30秒)より短く
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(25_000),
    // アウトボックスの送り出しを、この API のプロセスで回すか(ADR 0006)。別のサービスに分けたら off に
    OUTBOX_RELAY: z.enum(["on", "off"]).default("on"),
    // 運営の組織(社員が代理ログインに使う。docs/specs/0004-support-access.md)。無ければ代理ログインは使えない
    SUPPORT_TENANT_ID: z.uuid().optional(),
    // 失敗を Sentry に送る先(docs/guides/monitoring.md)。無ければ送らない
    SENTRY_DSN: z.url().optional(),
    // どの版の失敗か(Sentry で「この版から増えた」が分かる)。deploy.yml がイメージの digest を入れる
    SENTRY_RELEASE: z.string().max(200).optional(),
    // Sentry の1件に「このリクエストのログを開く」リンクを付ける(Terraform が入れる)
    LOGS_INSIGHTS_REGION: z.string().optional(),
    // 探すロググループ(カンマ区切り。API と画面のサーバー)
    LOGS_INSIGHTS_GROUPS: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MODE === "dev" && !DEV_LOGIN_ALLOWED.has(env.APP_ENV)) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_MODE"],
        message: `開発用ログインは ${env.APP_ENV} では使えません(local / test / preview だけ)`,
      });
    }
    if (!LOCAL_ONLY.has(env.APP_ENV) && env.APP_ENV !== "preview") {
      if (!env.MAIL_SMTP_URL) {
        ctx.addIssue({
          code: "custom",
          path: ["MAIL_SMTP_URL"],
          message: `${env.APP_ENV} ではメールを送る先(MAIL_SMTP_URL)が要ります`,
        });
      }
      if (!env.APP_URL) {
        ctx.addIssue({
          code: "custom",
          path: ["APP_URL"],
          message: `${env.APP_ENV} では画面の URL(APP_URL。メールのリンクに使う)が要ります`,
        });
      }
    }
    // 手元では偽物の受け口(http)を使ってよい
    if (env.SENTRY_DSN && !LOCAL_ONLY.has(env.APP_ENV) && !env.SENTRY_DSN.startsWith("https://")) {
      ctx.addIssue({
        code: "custom",
        path: ["SENTRY_DSN"],
        message: "SENTRY_DSN は https:// にしてください",
      });
    }
    if (env.AUTH_MODE !== "cognito") return;
    if (!(env.COGNITO_REGION && env.COGNITO_USER_POOL_ID && env.COGNITO_CLIENT_ID)) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_MODE"],
        message:
          "cognito には COGNITO_REGION / COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID が要ります",
      });
    }
    const local = LOCAL_ONLY.has(env.APP_ENV);
    if (env.COGNITO_ENDPOINT && !local) {
      ctx.addIssue({
        code: "custom",
        path: ["COGNITO_ENDPOINT"],
        message: "COGNITO_ENDPOINT(偽物の Cognito)は local / test だけで使えます",
      });
    }
    for (const key of ["COGNITO_ENDPOINT", "APP_URL"] as const) {
      const value = env[key];
      if (value && !local && !value.startsWith("https://")) {
        ctx.addIssue({ code: "custom", path: [key], message: `${key} は https:// にしてください` });
      }
      if (value?.endsWith("/")) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} の最後に / を付けないでください`,
        });
      }
    }
  });

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
    auth:
      e.AUTH_MODE === "cognito"
        ? {
            mode: "cognito" as const,
            region: e.COGNITO_REGION ?? "",
            userPoolId: e.COGNITO_USER_POOL_ID ?? "",
            clientId: e.COGNITO_CLIENT_ID ?? "",
            appUrl: e.APP_URL ?? DEFAULT_APP_URL,
            endpoint: e.COGNITO_ENDPOINT,
          }
        : { mode: "dev" as const },
    session: {
      secret: e.SESSION_SECRET,
      ttlSeconds: e.SESSION_TTL_SECONDS,
      // http の手元とテストだけ Secure を外す
      secureCookie: e.APP_ENV !== "local" && e.APP_ENV !== "test",
    },
    exposeOpenApi: e.APP_ENV !== "prod",
    appUrl: e.APP_URL ?? DEFAULT_APP_URL,
    mail: { smtpUrl: e.MAIL_SMTP_URL ?? null, from: e.MAIL_FROM },
    shutdownTimeoutMs: e.SHUTDOWN_TIMEOUT_MS,
    outboxRelay: e.OUTBOX_RELAY === "on",
    supportTenantId: e.SUPPORT_TENANT_ID ?? null,
    sentry: {
      dsn: e.SENTRY_DSN,
      release: e.SENTRY_RELEASE,
      logsLink: logsLinkFrom(e.LOGS_INSIGHTS_REGION, e.LOGS_INSIGHTS_GROUPS),
    },
  };
}

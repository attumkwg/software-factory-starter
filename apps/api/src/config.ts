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
    // Cognito の画面の入口(https://<接頭辞>.auth.<region>.amazoncognito.com)
    COGNITO_DOMAIN: z.url().optional(),
    // この画面の URL(戻り先 https://<APP_URL>/api/auth/callback を作る。Host ヘッダーは信じない)
    APP_URL: z.url().optional(),
    // 発行元を変える。手元の偽物の Cognito(packages/fake-cognito)だけ
    COGNITO_ISSUER: z.url().optional(),
    // ZAP の認証つきスキャン用のアプリクライアント(stg だけ)
    COGNITO_SCAN_CLIENT_ID: z.string().optional(),
    // メールを渡す先(Postfix)。smtp://mail:25 など。無ければ送らずに記録だけ(local / test / preview だけ)
    MAIL_SMTP_URL: z.url().optional(),
    // 送り元。SES で確かめたドメインのアドレス(例: "Tasks <no-reply@example.com>")
    MAIL_FROM: z.string().min(3).default("Tasks <no-reply@example.test>"),
    // ECS の stopTimeout(既定30秒)より短く
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(25_000),
    // アウトボックスの送り出しを、この API のプロセスで回すか(ADR 0006)。別のサービスに分けたら off に
    OUTBOX_RELAY: z.enum(["on", "off"]).default("on"),
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
    if (env.AUTH_MODE !== "cognito") return;
    if (
      !(
        env.COGNITO_REGION &&
        env.COGNITO_USER_POOL_ID &&
        env.COGNITO_CLIENT_ID &&
        env.COGNITO_DOMAIN &&
        env.APP_URL
      )
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_MODE"],
        message:
          "cognito には COGNITO_REGION / COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID / COGNITO_DOMAIN / APP_URL が要ります",
      });
    }
    const local = LOCAL_ONLY.has(env.APP_ENV);
    if (env.COGNITO_ISSUER && !local) {
      ctx.addIssue({
        code: "custom",
        path: ["COGNITO_ISSUER"],
        message: "COGNITO_ISSUER(偽物の Cognito)は local / test だけで使えます",
      });
    }
    for (const key of ["COGNITO_DOMAIN", "APP_URL"] as const) {
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
    if (env.COGNITO_SCAN_CLIENT_ID && env.APP_ENV === "prod") {
      ctx.addIssue({
        code: "custom",
        path: ["COGNITO_SCAN_CLIENT_ID"],
        message: "スキャン用のログイン(COGNITO_SCAN_CLIENT_ID)は prod では使えません",
      });
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
            domain: e.COGNITO_DOMAIN ?? "",
            appUrl: e.APP_URL ?? DEFAULT_APP_URL,
            issuer: e.COGNITO_ISSUER,
            scanClientId: e.COGNITO_SCAN_CLIENT_ID,
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
  };
}

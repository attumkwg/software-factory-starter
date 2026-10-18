import { z } from "zod";

// 環境の名前。開発用ログインを使ってよいのは local / test / preview だけ(本物の利用者がいない所)。
export const APP_ENVS = ["local", "test", "preview", "stg", "prod"] as const;
const DEV_LOGIN_ALLOWED: ReadonlySet<string> = new Set(["local", "test", "preview"]);

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
    // ECS の stopTimeout(既定30秒)より短く
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(25_000),
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MODE === "dev" && !DEV_LOGIN_ALLOWED.has(env.APP_ENV)) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_MODE"],
        message: `開発用ログインは ${env.APP_ENV} では使えません(local / test / preview だけ)`,
      });
    }
    if (
      env.AUTH_MODE === "cognito" &&
      !(env.COGNITO_REGION && env.COGNITO_USER_POOL_ID && env.COGNITO_CLIENT_ID)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_MODE"],
        message:
          "cognito には COGNITO_REGION / COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID が要ります",
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
          }
        : { mode: "dev" as const },
    session: {
      secret: e.SESSION_SECRET,
      ttlSeconds: e.SESSION_TTL_SECONDS,
      // http の手元とテストだけ Secure を外す
      secureCookie: e.APP_ENV !== "local" && e.APP_ENV !== "test",
    },
    exposeOpenApi: e.APP_ENV !== "prod",
    shutdownTimeoutMs: e.SHUTDOWN_TIMEOUT_MS,
  };
}

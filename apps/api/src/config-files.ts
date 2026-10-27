import { z } from "zod";

// 写真・ファイルの置き場の設定(docs/specs/0072-file-storage.md・docs/designs/0072-file-storage.md)。
// API の設定(config.ts)に混ぜて読むほか、運営のコマンド delete-tenant はこれだけを読む(API の全部の設定は要らない)。

// 手元の置き場の入口と固定の鍵を使ってよい所(config.ts の LOCAL_ONLY と同じ)
const LOCAL_ONLY: ReadonlySet<string> = new Set(["local", "test"]);

export const FILES_ENV_SHAPE = {
  // 置き場の名前。無ければファイルの API は 503(stg・prod は必須。Terraform の module.files)
  FILES_BUCKET: z.string().min(3).optional(),
  FILES_REGION: z.string().default("ap-northeast-1"),
  // 組織ごとに絞った権限を STS で引き受ける役割(stg・prod は必須。Terraform の出力 access_role_arn)
  FILES_ACCESS_ROLE_ARN: z.string().startsWith("arn:aws:iam::").optional(),
  // 手元・テストの S3 互換の置き場(RustFS)だけ: API から届く入口・ブラウザから届く入口・固定の鍵(秘密ではない手元専用の値)
  FILES_S3_ENDPOINT: z.url().optional(),
  FILES_S3_PUBLIC_ENDPOINT: z.url().optional(),
  FILES_S3_ACCESS_KEY: z.string().optional(),
  FILES_S3_SECRET_KEY: z.string().optional(),
};

const FilesEnvObject = z.object({
  APP_ENV: z.enum(["local", "test", "preview", "stg", "prod"]).default("local"),
  ...FILES_ENV_SHAPE,
});
type FilesEnv = z.infer<typeof FilesEnvObject>;
type FilesKey = Exclude<keyof FilesEnv, "APP_ENV">;
export type FilesIssue = { path: FilesKey; message: string };

const LOCAL_FILES_KEYS = [
  "FILES_S3_ENDPOINT",
  "FILES_S3_PUBLIC_ENDPOINT",
  "FILES_S3_ACCESS_KEY",
  "FILES_S3_SECRET_KEY",
] as const;

/**
 * stg・prod は必須(Terraform の module.files)。入口と固定の鍵は手元・テストだけ。
 * 本物の環境は STS の役割で組織ごとに絞る(ADR 0079)
 */
export function filesIssues(env: FilesEnv): FilesIssue[] {
  const local = LOCAL_ONLY.has(env.APP_ENV);
  const issues: FilesIssue[] = LOCAL_FILES_KEYS.filter((key) => env[key] && !local).map((key) => ({
    path: key,
    message: `${key}(手元の S3 互換の置き場)は local / test だけで使えます`,
  }));
  if (!env.FILES_BUCKET) {
    if (env.APP_ENV === "stg" || env.APP_ENV === "prod") {
      issues.push({
        path: "FILES_BUCKET",
        message: `${env.APP_ENV} では写真・ファイルの置き場(FILES_BUCKET)が要ります(Terraform の module.files)`,
      });
    }
    return issues;
  }
  return [...issues, ...credentialIssues(env, local)];
}

function credentialIssues(env: FilesEnv, local: boolean): FilesIssue[] {
  if (env.FILES_ACCESS_ROLE_ARN) return [];
  if (!local) {
    return [
      {
        path: "FILES_ACCESS_ROLE_ARN",
        message: `${env.APP_ENV} では組織ごとに絞る役割(FILES_ACCESS_ROLE_ARN)が要ります`,
      },
    ];
  }
  if (env.FILES_S3_ACCESS_KEY && env.FILES_S3_SECRET_KEY) return [];
  return [
    {
      path: "FILES_S3_ACCESS_KEY",
      message:
        "FILES_S3_ACCESS_KEY と FILES_S3_SECRET_KEY(手元の S3 互換の置き場)か FILES_ACCESS_ROLE_ARN が要ります",
    },
  ];
}

/** 置き場の名前が無ければ null */
export function filesConfig(e: FilesEnv) {
  if (!e.FILES_BUCKET) return null;
  const key = e.FILES_S3_ACCESS_KEY;
  const secret = e.FILES_S3_SECRET_KEY;
  return {
    bucket: e.FILES_BUCKET,
    region: e.FILES_REGION,
    accessRoleArn: e.FILES_ACCESS_ROLE_ARN ?? null,
    endpoint: e.FILES_S3_ENDPOINT,
    publicEndpoint: e.FILES_S3_PUBLIC_ENDPOINT,
    staticCredentials: key && secret ? { accessKeyId: key, secretAccessKey: secret } : null,
  };
}

/** 置き場の設定だけを読む(運営のコマンド用)。置き場の名前が無ければ null */
export function loadFilesConfig(env: Record<string, string | undefined> = process.env) {
  const parsed = FilesEnvObject.safeParse(env);
  const issues = parsed.success ? filesIssues(parsed.data) : [];
  if (!parsed.success || issues.length > 0) {
    const lines = parsed.success
      ? issues.map((i) => `- ${i.path}: ${i.message}`)
      : parsed.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`);
    throw new Error(`置き場の設定が正しくありません:\n${lines.join("\n")}`);
  }
  return filesConfig(parsed.data);
}

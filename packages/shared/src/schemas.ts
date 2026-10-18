import { z } from "zod";
import { RoleSchema } from "./roles.ts";
import { InstantSchema, TimeZoneSchema } from "./time.ts";

// 画面と API で共有する「契約」。API はここから OpenAPI を作り、画面は型として使う。
// 項目は足すだけ・消さない・意味を変えない(古い画面やアプリから呼ばれても壊れないように)。

export const IdSchema = z.uuid();

export const MeSchema = z.object({
  userId: IdSchema,
  tenantId: IdSchema,
  tenantName: z.string(),
  email: z.email(),
  name: z.string(),
  role: RoleSchema,
  /** 組織の時間帯。画面はこの時間帯で時刻を見せる(SSR とブラウザで同じになる) */
  timeZone: TimeZoneSchema,
});
export type Me = z.infer<typeof MeSchema>;

export const ProjectSchema = z.object({
  id: IdSchema,
  name: z.string(),
  createdAt: InstantSchema,
});
export type Project = z.infer<typeof ProjectSchema>;

export const CreateProjectSchema = z.object({
  name: z.string().trim().min(1).max(100),
});
export type CreateProject = z.infer<typeof CreateProjectSchema>;

export const TaskSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  title: z.string(),
  done: z.boolean(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type Task = z.infer<typeof TaskSchema>;

export const CreateTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
});
export type CreateTask = z.infer<typeof CreateTaskSchema>;

export const UpdateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    done: z.boolean().optional(),
  })
  .refine((v) => v.title !== undefined || v.done !== undefined, {
    message: "title か done のどちらかが必要です",
  });
export type UpdateTask = z.infer<typeof UpdateTaskSchema>;

/**
 * 失敗の種類。画面・スマホはこの code で分岐する(message は人が読む説明で、変わりうる)。
 * 足すのはよいが、消す・意味を変えるのはしない(古い画面が残るため)。
 */
export const ERROR_CODES = [
  "bad_request", // 入力が正しくない(400)
  "unauthorized", // ログインしていない(401)
  "login_failed", // ログインできなかった(401)
  "forbidden", // 権限が無い(403)
  "not_found", // 無い・他社の物(404)
  "conflict", // ほかの変更とぶつかった(409)。読み直して、やり直せば通ることがある
  "payload_too_large", // 本文が大きすぎる(413)
  "unsupported_media_type", // 本文が JSON ではない(415)
  "service_unavailable", // DB などが一時的に使えない(503)。少し待てば通る
  "internal", // それ以外の想定外(500)
  "invalid_code", // 確認コード・二段階認証のコードが違う・切れた(400)
  "invalid_password", // パスワードが決まり(cognito-settings.json)を満たさない(400)
  "too_many_requests", // 短い間に試しすぎた(429)。少し待てば通る
] as const;
export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

// OpenAPI では code を「増えることがある一覧」(x-extensible-enum)として書く。enum にすると、code を足しただけで
// 互換の検査(oasdiff)が「壊す変更」と判定する(足すのは、してよい変更。docs/guides/api-changes.md)。
// 画面・アプリは知らない code が来ても動くように書く(apps/web/src/errors.ts)。
const ExtensibleErrorCode = z.string().meta({
  description:
    "失敗の種類(ERROR_CODES)。増えることがある。知らない値は「うまくいきませんでした」として扱う",
  "x-extensible-enum": [...ERROR_CODES],
});

export const ErrorSchema = z.object({
  error: z.object({
    code: ExtensibleErrorCode,
    message: z.string(),
    requestId: z.string().optional(),
  }),
});
/** 失敗の本文の型(code はこの版で知っている物。古い版の画面には知らない code が届きうる) */
export type ApiError = { error: { code: ErrorCode; message: string; requestId?: string } };

export const DevLoginSchema = z.object({
  email: z.email(),
});

/**
 * ログインの方式(GET /api/auth/options)。画面はこれを見て、ログインとログアウトの出し方を変える。
 *   dev     … 開発用ログイン(local / test / preview だけ)
 *   cognito … Cognito の画面へ移る。logoutUrl は Cognito 側のログインも終わらせる行き先
 */
export const AuthOptionsSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("dev") }),
  z.object({ method: z.literal("cognito"), logoutUrl: z.url() }),
]);
export type AuthOptions = z.infer<typeof AuthOptionsSchema>;

/**
 * ログインの後に戻る先。**アプリの中のパスだけ**を通す(よそのサイトへ飛ばされる穴を作らない)。
 * 「/」で始まり、「//」「/\」(よそのサイトの意味になる)・/api・制御文字・長すぎるものは「/」にする。
 */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || value.length > 512) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  // ブラウザは「\」を「/」と読むので、「/\evil.example」もよそのサイトになる。どこにあっても弾く
  if (value.includes("\\")) return "/";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 制御文字を見つけて弾くため
  if (/[\u0000-\u001f\u007f]/.test(value)) return "/";
  if (value === "/api" || value.startsWith("/api/") || value.startsWith("/api?")) return "/";
  if (value === "/login" || value.startsWith("/login?")) return "/";
  return value;
}

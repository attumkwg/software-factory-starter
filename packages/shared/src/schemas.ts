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
] as const;
export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    requestId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof ErrorSchema>;

export const DevLoginSchema = z.object({
  email: z.email(),
});

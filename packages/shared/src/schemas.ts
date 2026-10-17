import { z } from "zod";
import { RoleSchema } from "./roles.ts";

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
});
export type Me = z.infer<typeof MeSchema>;

export const ProjectSchema = z.object({
  id: IdSchema,
  name: z.string(),
  createdAt: z.iso.datetime(),
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
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
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

export const ErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof ErrorSchema>;

export const DevLoginSchema = z.object({
  email: z.email(),
});
